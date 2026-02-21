// agency_bot.cjs — ClientMagnet Outreach (Flipify Validation)
require("dotenv").config();
const snoowrap = require("snoowrap");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");

/* =========================
   REDDIT CLIENT
========================= */
const reddit = new snoowrap({
  userAgent: process.env.REDDIT_USER_AGENT,
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
});

/* =========================
   PATHS
========================= */
const baseDir = path.resolve(__dirname, "logs");
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

const leadsPath = path.join(baseDir, "clean_leads.csv");
const sentPath = path.join(baseDir, "clean_leads_dmed.csv");
const sentStatePath = path.join(baseDir, "clean_leads_sentState.json");

/* =========================
   RATE LIMITING — UNCHANGED FROM ORIGINAL
========================= */
const MIN_DMS_PER_CYCLE = 15;
const MAX_DMS_PER_CYCLE = 25;
const MIN_DELAY_MS = 3 * 60 * 1000;   // 3 minutes
const MAX_DELAY_MS = 5 * 60 * 1000;   // 5 minutes

/* =========================
   MEMORY
========================= */
let sentUrlSet = new Set();
let sentUserSet = new Set();
let initialized = false;

/* =========================
   CSV WRITER — FLIPIFY VALIDATION FIELDS
   
   Extended with validation logging columns:
   - painConfirmed: Y/N — did they confirm a real pain in their post?
   - currentMethod: spreadsheet / gut / none / other
   - expressedInterest: Y/N — did language suggest they'd want a tool?
   - followUpPotential: Y/N — worth a follow-up if no response?
========================= */
const sentWriter = createObjectCsvWriter({
  path: sentPath,
  header: [
    { id: "username",          title: "Username" },
    { id: "title",             title: "Post Title" },
    { id: "url",               title: "Post URL" },
    { id: "subreddit",         title: "Subreddit" },
    { id: "leadType",          title: "Lead Type" },
    { id: "matchedTrigger",    title: "Matched Trigger" },
    { id: "templateUsed",      title: "Template Used" },
    { id: "dmSentTime",        title: "DM Sent Time" },
    { id: "status",            title: "Status" },
    // Flipify validation fields
    { id: "painConfirmed",     title: "Pain Confirmed (Y/N)" },
    { id: "currentMethod",     title: "Current Method (spreadsheet/gut/none/other)" },
    { id: "expressedInterest", title: "Expressed Interest in Tool (Y/N)" },
    { id: "followUpPotential", title: "Follow-Up Potential (Y/N)" }
  ],
  append: true
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* =========================
   STATE LOADERS — UNCHANGED
========================= */
function loadJsonState() {
  if (!fs.existsSync(sentStatePath)) return;
  try {
    const data = JSON.parse(fs.readFileSync(sentStatePath, "utf8"));
    if (data.urls) data.urls.forEach(u => sentUrlSet.add(u));
    if (data.users) data.users.forEach(u => sentUserSet.add(u.toLowerCase()));
  } catch {}
}

function saveJsonState() {
  fs.writeFileSync(
    sentStatePath,
    JSON.stringify({
      urls: [...sentUrlSet],
      users: [...sentUserSet]
    }, null, 2)
  );
}

function loadCsvState() {
  return new Promise(resolve => {
    if (!fs.existsSync(sentPath)) return resolve();
    fs.createReadStream(sentPath)
      .pipe(csv())
      .on("data", row => {
        if (row.username) sentUserSet.add(row.username.toLowerCase());
        if (row.url) sentUrlSet.add(row.url);
      })
      .on("end", resolve)
      .on("error", resolve);
  });
}

function loadLeads() {
  return new Promise(resolve => {
    if (!fs.existsSync(leadsPath)) return resolve([]);
    const arr = [];
    fs.createReadStream(leadsPath)
      .pipe(csv())
      .on("data", row => arr.push(row))
      .on("end", () => resolve(arr))
      .on("error", () => resolve(arr));
  });
}

/* =========================
   LEAD SCORING — FLIPIFY
   
   Prioritizes active flippers with financial pain signals
========================= */
function scoreLead(p) {
  let score = 0;
  const trigger = (p.matchedTrigger || "").toLowerCase();

  // Lead type scoring
  if (p.leadType === "ACTIVE_FLIPPER_PAIN") score += 5;
  if (p.leadType === "RESELLER_PAIN") score += 3;

  // High-value pain signals
  if (trigger.includes("lost money") || trigger.includes("losing money")) score += 4;
  if (trigger.includes("overpaid") || trigger.includes("overbid")) score += 4;
  if (trigger.includes("unexpected repair") || trigger.includes("hidden damage")) score += 3;
  if (trigger.includes("margin") || trigger.includes("break even")) score += 3;
  if (trigger.includes("comp") || trigger.includes("kbb") || trigger.includes("book value")) score += 2;
  if (trigger.includes("auction")) score += 2;
  if (trigger.includes("roi") || trigger.includes("calculate") || trigger.includes("spreadsheet")) score += 3;
  if (trigger.includes("couldn't sell") || trigger.includes("no offers") || trigger.includes("sitting")) score += 2;

  // High-signal subreddits
  if (["carflipping", "askcarsales", "flipping"].includes(p.subreddit)) score += 2;

  return score;
}

/* =========================
   DM TEMPLATES — FLIPIFY VALIDATION
   
   Rules enforced across ALL templates:
   ✓ Single question only
   ✓ Conversational tone — not salesy
   ✓ No product pitch
   ✓ No links
   ✓ Under 3 sentences
   ✓ Asks how they calculate ROI / profit before buying
   ✓ References their specific pain trigger naturally
   
   7 rotating variants to avoid pattern detection
========================= */
function getTemplate(post) {
  const trigger = post.matchedTrigger || "that flip";
  const templates = [];

  // Template 1: Loss empathy
  templates.push({
    id: "FLIPIFY_T1",
    subject: "Quick question",
    text: `Saw your post about ${trigger} — rough one. Curious, how do you usually figure out your all-in cost before you commit to buying?`
  });

  // Template 2: Neutral / process focused
  templates.push({
    id: "FLIPIFY_T2",
    subject: "Quick question",
    text: `Your post caught my eye. How do you typically calculate whether a car is worth buying before you pull the trigger — do you have a system or is it more feel?`
  });

  // Template 3: Auction angle
  templates.push({
    id: "FLIPIFY_T3",
    subject: "Quick question",
    text: `Saw your post about ${trigger}. Do you have a method for estimating total profit before you bid, or do you mostly go off instinct at the auction?`
  });

  // Template 4: Repair cost angle
  templates.push({
    id: "FLIPIFY_T4",
    subject: "Quick question",
    text: `Your post on ${trigger} hit home. How do you account for repair costs when you're deciding what to pay for a car?`
  });

  // Template 5: Comp / pricing angle
  templates.push({
    id: "FLIPIFY_T5",
    subject: "Quick question",
    text: `Noticed your post about ${trigger}. When you're pricing a car to resell, how do you pull comps — is there a process you follow or does it vary?`
  });

  // Template 6: ROI direct
  templates.push({
    id: "FLIPIFY_T6",
    subject: "Quick question",
    text: `Saw your post about ${trigger}. Genuinely curious — do you calculate ROI before buying, or does it usually come together after the fact?`
  });

  // Template 7: Spreadsheet angle
  templates.push({
    id: "FLIPIFY_T7",
    subject: "Quick question",
    text: `Your post about ${trigger} made me wonder — do you use any kind of tracker or spreadsheet when you're evaluating a flip, or do you keep it in your head?`
  });

  return templates[Math.floor(Math.random() * templates.length)];
}

/* =========================
   INIT
========================= */
async function initState() {
  if (initialized) return;
  loadJsonState();
  await loadCsvState();
  console.log(`Loaded state — ${sentUserSet.size} users, ${sentUrlSet.size} URLs`);
  initialized = true;
}

/* =========================
   DM CYCLE — UNCHANGED LOGIC, FLIPIFY FIELDS ADDED
========================= */
async function runCycle() {
  let leads = await loadLeads();
  if (!leads.length) {
    console.log("No leads available. Waiting for scraper...");
    return;
  }

  leads = leads
    .filter(l => l.username && l.url && l.leadType)
    .sort((a, b) => scoreLead(b) - scoreLead(a));

  console.log(`Loaded ${leads.length} leads.`);

  const targetDMs = MIN_DMS_PER_CYCLE + Math.floor(Math.random() * (MAX_DMS_PER_CYCLE - MIN_DMS_PER_CYCLE + 1));

  let attempted = 0;
  let confirmed = 0;

  const cycleUsers = new Set();
  const cycleUrls = new Set();

  for (const post of leads) {
    if (attempted >= targetDMs) {
      console.log(`Reached cycle target (${targetDMs} DMs). Moving to next cycle.`);
      break;
    }

    const rawUser = post.username.trim();
    const username = rawUser.toLowerCase();
    const url = post.url.trim();

    if (
      sentUserSet.has(username) ||
      sentUrlSet.has(url) ||
      cycleUsers.has(username) ||
      cycleUrls.has(url)
    ) continue;

    attempted++;

    try {
      const tpl = getTemplate(post);
      const dmSentTime = new Date().toISOString();

      await reddit.composeMessage({
        to: rawUser,
        subject: tpl.subject,
        text: tpl.text
      });

      confirmed++;
      console.log(`\n✓ DM sent to u/${rawUser}`);
      console.log(`  Lead Type: ${post.leadType}`);
      console.log(`  Pain Signal: "${post.matchedTrigger}"`);
      console.log(`  Template: ${tpl.id}`);
      console.log(`  Post URL: ${url}`);
      console.log(`  Time: ${dmSentTime}`);

      sentUserSet.add(username);
      sentUrlSet.add(url);
      cycleUsers.add(username);
      cycleUrls.add(url);

      // Log with Flipify validation fields (blanks filled manually after responses come in)
      await sentWriter.writeRecords([{
        username:          rawUser,
        title:             post.title,
        url,
        subreddit:         post.subreddit,
        leadType:          post.leadType,
        matchedTrigger:    post.matchedTrigger,
        templateUsed:      tpl.id,
        dmSentTime:        dmSentTime,
        status:            "OUTREACH",
        painConfirmed:     "",   // Fill after response: Y / N
        currentMethod:     "",   // Fill after response: spreadsheet / gut / none / other
        expressedInterest: "",   // Fill after response: Y / N
        followUpPotential: ""    // Fill after response: Y / N
      }]);

      saveJsonState();

      const delayMs = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
      const delayMins = Math.round(delayMs / 60000);

      if (attempted < targetDMs) {
        console.log(`  Waiting ${delayMins} minutes before next DM...`);
        await sleep(delayMs);
      }

    } catch (err) {
      console.log(`✗ Failed DM to u/${rawUser}: ${err.message}`);
      if (err.message.includes("NOT_WHITELISTED") || err.message.includes("USER_DOESNT_EXIST")) {
        sentUserSet.add(username);
        saveJsonState();
      }
    }
  }

  console.log(`\nCycle complete — attempted ${attempted}, confirmed ${confirmed}`);
}

/* =========================
   LOOP — UNCHANGED FROM ORIGINAL
========================= */
(async () => {
  await initState();

  console.log("=".repeat(60));
  console.log("ClientMagnet Bot — Flipify Validation Outreach");
  console.log("=".repeat(60));
  console.log(`DMs per cycle: ${MIN_DMS_PER_CYCLE}-${MAX_DMS_PER_CYCLE} (randomized)`);
  console.log(`Delay between DMs: ${MIN_DELAY_MS/60000}-${MAX_DELAY_MS/60000} minutes`);
  console.log(`Cycle delay: 8-12 minutes`);
  console.log(`Daily capacity: ~150-200 DMs`);
  console.log("=".repeat(60));

  while (true) {
    console.log(`\n[${new Date().toLocaleString()}] Starting new DM cycle...`);
    await runCycle();

    const cycleDelay = (8 + Math.floor(Math.random() * 4)) * 60 * 1000;
    console.log(`Waiting ${Math.round(cycleDelay/60000)} minutes until next cycle...`);
    await sleep(cycleDelay);
  }
})();
