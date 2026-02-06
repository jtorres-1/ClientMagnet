// agency_bot.cjs — ClientMagnet Outreach (HVAC & Blue Collar Contractors)
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
   RATE LIMITING CONFIG
   
   AGGRESSIVE MODE - High volume while staying under Reddit limits:
   - Reddit API limit: 60 requests/minute, 1/second
   - Safe DM rate: 3-5 min delays (well under limits)
   - 15-25 DMs per cycle
   - Shorter cycle delays for maximum daily throughput
   
   Daily capacity: ~150-200 DMs/day
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
   CSV WRITER
========================= */
const sentWriter = createObjectCsvWriter({
  path: sentPath,
  header: [
    { id: "username", title: "Username" },
    { id: "title", title: "Post Title" },
    { id: "url", title: "Post URL" },
    { id: "subreddit", title: "Subreddit" },
    { id: "leadType", title: "Lead Type" },
    { id: "matchedTrigger", title: "Matched Trigger" },
    { id: "templateUsed", title: "Template Used" },
    { id: "dmSentTime", title: "DM Sent Time" },
    { id: "status", title: "Status" }
  ],
  append: true
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* =========================
   STATE LOADERS
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
   LEAD SCORING (HVAC/CONTRACTOR FOCUS)
   
   Priority:
   1. OWNER_WITH_PAIN (highest - confirmed owner with clear pain)
   2. LIKELY_OWNER (medium - probable owner with pain signal)
========================= */
function scoreLead(p) {
  let score = 0;
  const title = (p.title || "").toLowerCase();
  const trigger = (p.matchedTrigger || "").toLowerCase();

  // Lead type scoring
  if (p.leadType === "OWNER_WITH_PAIN") score += 5;
  if (p.leadType === "LIKELY_OWNER") score += 3;

  // High-intent pain signals
  if (trigger.includes("leads") || trigger.includes("lead gen")) score += 3;
  if (trigger.includes("calls") || trigger.includes("missed calls")) score += 3;
  if (trigger.includes("scheduling") || trigger.includes("booking")) score += 2;
  if (trigger.includes("slow season") || trigger.includes("growth")) score += 2;
  if (trigger.includes("answering phones")) score += 2;
  
  // HVAC-specific bonus (core niche)
  if (["HVAC", "HVACR"].includes(p.subreddit)) score += 2;
  
  return score;
}

/* =========================
   DM TEMPLATES (HVAC/CONTRACTOR OUTREACH)
   
   STRATEGY:
   - Human, conversational tone
   - Short (3 sentences max)
   - Curious, not salesy
   - Reference their specific pain
   - Soft question close
   - No pricing, no links, no automation mentions
   
   ROTATION: 5 templates to avoid spam patterns
========================= */
function getTemplate(post) {
  const trigger = post.matchedTrigger || "business challenge";
  const templates = [];

  // Template 1: Empathy + Solution Hint
  templates.push({
    id: "TEMPLATE_1",
    subject: `Re: ${trigger}`,
    text: `Hey, saw your post about ${trigger}. I've been helping contractors automate booking and missed call capture without hiring more staff. Open to a quick convo if that's useful?`
  });

  // Template 2: Direct Problem-Solver
  templates.push({
    id: "TEMPLATE_2",
    subject: "Quick question",
    text: `Saw your post on ${trigger}. I work with HVAC guys on this exact issue—turning missed calls into booked jobs. Worth a chat?`
  });

  // Template 3: Case Study Approach
  templates.push({
    id: "TEMPLATE_3",
    subject: "Might be helpful",
    text: `Hey, noticed you mentioned ${trigger}. Just helped an AC company capture 80% more inbound calls without adding staff. Happy to share what worked if it's relevant.`
  });

  // Template 4: Curiosity Angle
  templates.push({
    id: "TEMPLATE_4",
    subject: "Following up",
    text: `Saw your comment about ${trigger}. Curious—are you handling scheduling in-house or using something? I've got a setup that could help.`
  });

  // Template 5: Peer Approach
  templates.push({
    id: "TEMPLATE_5",
    subject: "Same boat",
    text: `Your post on ${trigger} hit home. Most contractors I work with lose 30-40% of calls to voicemail. Fixed this for a few shops if you want to compare notes.`
  });

  // Randomize to avoid patterns
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
   DM CYCLE
========================= */
async function runCycle() {
  let leads = await loadLeads();
  if (!leads.length) {
    console.log("No leads available.");
    return;
  }

  // Filter and sort leads by score
  leads = leads
    .filter(l => l.username && l.url && l.leadType)
    .sort((a, b) => scoreLead(b) - scoreLead(a));

  console.log(`Loaded ${leads.length} leads.`);

  // Randomize DM count per cycle (6-10)
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

    // Skip if already contacted
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

      // Update state
      sentUserSet.add(username);
      sentUrlSet.add(url);
      cycleUsers.add(username);
      cycleUrls.add(url);

      // Log to CSV
      await sentWriter.writeRecords([{
        username: rawUser,
        title: post.title,
        url,
        subreddit: post.subreddit,
        leadType: post.leadType,
        matchedTrigger: post.matchedTrigger,
        templateUsed: tpl.id,
        dmSentTime: dmSentTime,
        status: "OUTREACH"
      }]);

      saveJsonState();

      // Random delay between 6-12 minutes
      const delayMs = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
      const delayMins = Math.round(delayMs / 60000);
      
      if (attempted < targetDMs) {
        console.log(`  Waiting ${delayMins} minutes before next DM...`);
        await sleep(delayMs);
      }

    } catch (err) {
      console.log(`✗ Failed DM to u/${rawUser}: ${err.message}`);
      
      // If user doesn't accept DMs, mark as contacted to skip in future
      if (err.message.includes("NOT_WHITELISTED") || err.message.includes("USER_DOESNT_EXIST")) {
        sentUserSet.add(username);
        saveJsonState();
      }
    }
  }

  console.log(
    `\nCycle complete — attempted ${attempted}, confirmed ${confirmed}`
  );
}

/* =========================
   LOOP
========================= */
(async () => {
  await initState();
  
  console.log("=".repeat(60));
  console.log("ClientMagnet Bot - HVAC & Blue Collar Contractor Outreach");
  console.log("AGGRESSIVE MODE - High Volume");
  console.log("=".repeat(60));
  console.log(`DMs per cycle: ${MIN_DMS_PER_CYCLE}-${MAX_DMS_PER_CYCLE} (randomized)`);
  console.log(`Delay between DMs: ${MIN_DELAY_MS/60000}-${MAX_DELAY_MS/60000} minutes`);
  console.log(`Cycle delay: 8-12 minutes`);
  console.log(`Daily capacity: ~150-200 DMs (Reddit-safe limits)`);
  console.log("=".repeat(60));
  
  while (true) {
    console.log(`\n[${new Date().toLocaleString()}] Starting new DM cycle...`);
    await runCycle();
    
    // Wait 8-12 minutes between cycles (aggressive mode)
    const cycleDelay = (8 + Math.floor(Math.random() * 4)) * 60 * 1000;
    console.log(`Waiting ${Math.round(cycleDelay/60000)} minutes until next cycle...`);
    await sleep(cycleDelay);
  }
})();
