// agency_bot.cjs — ClientMagnet Outreach (Automation Services - Freelance)
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
   
   No daily limit - just speed control:
   - 5-10 min delays between DMs (Reddit-safe)
   - Max ~8-12 DMs per cycle
   - Continuous cycles with breaks
========================= */
const MAX_DMS_PER_CYCLE = 12;
const MIN_DELAY_MS = 5 * 60 * 1000;  // 5 minutes
const MAX_DELAY_MS = 10 * 60 * 1000; // 10 minutes

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
   LEAD SCORING (AUTOMATION SERVICES)
   
   Priority:
   1. TOOL_SEEKING (highest intent - actively looking for automation)
   2. AUTOMATION_PAIN (medium-high intent - complaining about manual work)
   3. WORKFLOW_PAIN (medium intent - general efficiency seeking)
========================= */
function scoreLead(p) {
  let score = 0;
  const title = (p.title || "").toLowerCase();
  const trigger = (p.matchedTrigger || "").toLowerCase();

  // Lead type scoring
  if (p.leadType === "TOOL_SEEKING") score += 5;
  if (p.leadType === "AUTOMATION_PAIN") score += 4;
  if (p.leadType === "WORKFLOW_PAIN") score += 2;

  // Subreddit bonus (business-focused subs)
  if (["ecommerce", "shopify", "SaaS"].includes(p.subreddit)) score += 2;
  if (["Entrepreneur", "startups"].includes(p.subreddit)) score += 1;
  
  // High-intent keyword bonus
  if (trigger.includes("scraper") || trigger.includes("bot")) score += 2;
  if (trigger.includes("automate")) score += 1;
  if (trigger.includes("manual data entry") || trigger.includes("excel hell")) score += 1;

  return score;
}

/* =========================
   DM TEMPLATES (AUTOMATION SERVICES)
   
   STRATEGY:
   - Direct, no-BS approach
   - Lead with results/time savings
   - Clear pricing ($750 fixed, 50% upfront)
   - Yes/no close (low friction)
   - Rotate 3 templates to avoid spam detection
   
   TEMPLATES:
   1. Time-saving angle (for automation pain)
   2. Quick fix angle (for tool seekers)
   3. Experience angle (general)
========================= */
function getTemplate(post) {
  const trigger = post.matchedTrigger || "manual task";
  const templates = [];

  // Template 1: Time-saving angle (best for AUTOMATION_PAIN)
  templates.push({
    id: "TEMPLATE_1",
    subject: `Re: ${trigger}`,
    text: `Hey, saw your post about ${trigger}.

I build custom bots/scrapers to automate that — saved a client 10+ hrs/week on similar manual work.

$750 fixed, 50% upfront. Interested? Yes/no`
  });

  // Template 2: Quick fix angle (best for TOOL_SEEKING)
  templates.push({
    id: "TEMPLATE_2",
    subject: "Quick automation fix",
    text: `Quick: I can fix the ${trigger} you mentioned with automation.

Custom scraper/bot, $750–$1,200, start this week. Yes/no?`
  });

  // Template 3: Experience angle (general)
  templates.push({
    id: "TEMPLATE_3",
    subject: "Automation solution",
    text: `I automate ${trigger} daily for clients.

Built similar bots — $750 fixed. DM if serious.`
  });

  // Rotate based on lead type for optimal matching
  if (post.leadType === "TOOL_SEEKING") {
    // Prefer template 2 for tool seekers
    return Math.random() < 0.5 ? templates[1] : templates[0];
  } else if (post.leadType === "AUTOMATION_PAIN") {
    // Prefer template 1 for pain complainers
    return Math.random() < 0.5 ? templates[0] : templates[2];
  } else {
    // Random for workflow pain
    return templates[Math.floor(Math.random() * templates.length)];
  }
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

  // Filter and sort leads
  leads = leads
    .filter(l => l.username && l.url && l.leadType)
    .sort((a, b) => scoreLead(b) - scoreLead(a));

  console.log(`Loaded ${leads.length} leads.`);

  let attempted = 0;
  let confirmed = 0;

  const cycleUsers = new Set();
  const cycleUrls = new Set();

  for (const post of leads) {
    if (attempted >= MAX_DMS_PER_CYCLE) {
      console.log(`Reached cycle limit (${MAX_DMS_PER_CYCLE}). Moving to next cycle.`);
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
      console.log(`  Keyword: "${post.matchedTrigger}"`);
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

      // Random delay between 5-10 minutes
      const delayMs = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
      const delayMins = Math.round(delayMs / 60000);
      
      if (attempted < MAX_DMS_PER_CYCLE) {
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
  console.log("ClientMagnet Bot - Automation Services Outreach");
  console.log("=".repeat(60));
  console.log(`Max DMs per cycle: ${MAX_DMS_PER_CYCLE}`);
  console.log(`Delay between DMs: ${MIN_DELAY_MS/60000}-${MAX_DELAY_MS/60000} minutes`);
  console.log("No daily limit - runs continuously");
  console.log("=".repeat(60));
  
  while (true) {
    console.log(`\n[${ new Date().toLocaleString()}] Starting new DM cycle...`);
    await runCycle();
    
    // Wait 12-20 minutes between cycles
    const cycleDelay = (12 + Math.floor(Math.random() * 8)) * 60 * 1000;
    console.log(`Waiting ${Math.round(cycleDelay/60000)} minutes until next cycle...`);
    await sleep(cycleDelay);
  }
})();
