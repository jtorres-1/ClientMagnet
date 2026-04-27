// agency_bot.cjs — ClientMagnet Outreach (Dev Job Kit)
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

const leadsPath    = path.join(baseDir, "clean_leads.csv");
const sentPath     = path.join(baseDir, "clean_leads_dmed.csv");
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
let sentUrlSet  = new Set();
let sentUserSet = new Set();
let initialized = false;

/* =========================
   CSV WRITER — DEV JOB KIT FIELDS
========================= */
const sentWriter = createObjectCsvWriter({
  path: sentPath,
  header: [
    { id: "username",       title: "Username" },
    { id: "title",          title: "Post Title" },
    { id: "url",            title: "Post URL" },
    { id: "subreddit",      title: "Subreddit" },
    { id: "leadType",       title: "Lead Type" },
    { id: "matchedTrigger", title: "Matched Trigger" },
    { id: "templateUsed",   title: "Template Used" },
    { id: "dmSentTime",     title: "DM Sent Time" },
    { id: "status",         title: "Status" },
    { id: "replied",        title: "Replied (Y/N)" },
    { id: "converted",      title: "Converted (Y/N)" },
    { id: "followUpSent",   title: "Follow-Up Sent (Y/N)" }
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
    if (data.urls)  data.urls.forEach(u  => sentUrlSet.add(u));
    if (data.users) data.users.forEach(u => sentUserSet.add(u.toLowerCase()));
  } catch {}
}

function saveJsonState() {
  fs.writeFileSync(
    sentStatePath,
    JSON.stringify({
      urls:  [...sentUrlSet],
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
        if (row.url)      sentUrlSet.add(row.url);
      })
      .on("end",   resolve)
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
      .on("end",  () => resolve(arr))
      .on("error", () => resolve(arr));
  });
}

/* =========================
   LEAD SCORING — DEV JOB KIT

   Prioritizes active seekers with high-frustration signals
========================= */
function scoreLead(p) {
  let score = 0;
  const trigger = (p.matchedTrigger || "").toLowerCase();

  // Lead type scoring
  if (p.leadType === "ACTIVE_SEEKER_PAIN")  score += 5;
  if (p.leadType === "GENERAL_JOB_PAIN")    score += 3;

  // High-value pain signals
  if (trigger.includes("no callbacks") || trigger.includes("no response"))  score += 4;
  if (trigger.includes("no interviews"))                                     score += 4;
  if (trigger.includes("applied to") || trigger.includes("hundreds"))       score += 4;
  if (trigger.includes("ghosted"))                                           score += 3;
  if (trigger.includes("months"))                                            score += 3;
  if (trigger.includes("resume") || trigger.includes("cover letter"))       score += 3;
  if (trigger.includes("ats"))                                               score += 3;
  if (trigger.includes("laid off") || trigger.includes("unemployed"))       score += 2;
  if (trigger.includes("desperate") || trigger.includes("hopeless"))        score += 2;

  // High-signal subreddits
  if (["cscareerquestions", "recruitinghell", "resumes"].includes(p.subreddit)) score += 2;

  return score;
}

/* =========================
   DM TEMPLATES — DEV JOB KIT

   Rules enforced across ALL templates:
   ✓ Casual, lowercase tone
   ✓ References their specific pain trigger
   ✓ Not salesy — feels like a real person
   ✓ Includes jobkit.tech link naturally
   ✓ Under 4 sentences
   ✓ 7 rotating variants to avoid pattern detection
========================= */
function getTemplate(post) {
  const trigger = post.matchedTrigger || "the job search";
  const templates = [];

  // Template 1 — Empathy + soft pitch
  templates.push({
    id: "JK_T1",
    subject: "something that might help",
    text: `hey, saw your post about ${trigger} — that's genuinely exhausting. i built a small tool called jobkit that takes your resume + a job description and instantly writes tailored bullets, a cover letter, and a "why i fit" paragraph. might save you a ton of time. jobkit.tech if you want to check it out, no pressure`
  });

  // Template 2 — Direct and short
  templates.push({
    id: "JK_T2",
    subject: "quick thing re: your post",
    text: `yo saw your post about ${trigger}. built something that might actually help — paste your resume + job description and it generates tailored resume bullets, a cover letter, and your pitch in seconds. $9 one time, no subscription. jobkit.tech`
  });

  // Template 3 — Resume angle
  templates.push({
    id: "JK_T3",
    subject: "re: your job search",
    text: `saw your post and felt it — the resume tailoring grind is brutal. made a tool that does it automatically. you paste your resume + the job post, it spits out tailored bullets, a clean cover letter, and a why-you-fit paragraph. jobkit.tech — takes about 10 seconds`
  });

  // Template 4 — ATS angle
  templates.push({
    id: "JK_T4",
    subject: "something that might help",
    text: `hey, noticed your post about ${trigger}. a big part of getting past ATS is tailoring your resume to each job — which is annoying to do manually. built a tool that handles it automatically. jobkit.tech — you paste your resume + the job description and it writes everything for you`
  });

  // Template 5 — Volume angle
  templates.push({
    id: "JK_T5",
    subject: "re: your applications",
    text: `saw your post about ${trigger} — sending that many apps with no response is rough. the problem is usually that the resume isn't tailored to each role. i built jobkit to fix that — it writes tailored bullets + a cover letter for any job in seconds. jobkit.tech`
  });

  // Template 6 — Soft question opener
  templates.push({
    id: "JK_T6",
    subject: "quick question",
    text: `hey saw your post about ${trigger} — are you tailoring your resume for each application or sending the same one? asking because i built jobkit.tech which does it automatically. paste your resume + the job post and it generates tailored bullets, a cover letter, and a pitch instantly`
  });

  // Template 7 — Laid off / urgency angle
  templates.push({
    id: "JK_T7",
    subject: "something useful for your search",
    text: `saw your post — job hunting after a layoff is one of the worst situations. built a tool that takes your resume + any job description and writes tailored application materials in about 10 seconds. no subscription, just $9 one time. jobkit.tech — hope it helps`
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
   DM CYCLE — UNCHANGED LOGIC, DEV JOB KIT FIELDS
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
  const cycleUrls  = new Set();

  for (const post of leads) {
    if (attempted >= targetDMs) {
      console.log(`Reached cycle target (${targetDMs} DMs). Moving to next cycle.`);
      break;
    }

    const rawUser  = post.username.trim();
    const username = rawUser.toLowerCase();
    const url      = post.url.trim();

    if (
      sentUserSet.has(username) ||
      sentUrlSet.has(url)       ||
      cycleUsers.has(username)  ||
      cycleUrls.has(url)
    ) continue;

    attempted++;

    try {
      const tpl       = getTemplate(post);
      const dmSentTime = new Date().toISOString();

      await reddit.composeMessage({
        to:      rawUser,
        subject: tpl.subject,
        text:    tpl.text
      });

      confirmed++;
      console.log(`\n✓ DM sent to u/${rawUser}`);
      console.log(`  Lead Type:    ${post.leadType}`);
      console.log(`  Pain Signal:  "${post.matchedTrigger}"`);
      console.log(`  Template:     ${tpl.id}`);
      console.log(`  Post URL:     ${url}`);
      console.log(`  Time:         ${dmSentTime}`);

      sentUserSet.add(username);
      sentUrlSet.add(url);
      cycleUsers.add(username);
      cycleUrls.add(url);

      await sentWriter.writeRecords([{
        username:       rawUser,
        title:          post.title,
        url,
        subreddit:      post.subreddit,
        leadType:       post.leadType,
        matchedTrigger: post.matchedTrigger,
        templateUsed:   tpl.id,
        dmSentTime,
        status:         "OUTREACH",
        replied:        "",   // Fill manually after response: Y / N
        converted:      "",   // Fill manually after purchase: Y / N
        followUpSent:   ""    // Fill manually after follow-up: Y / N
      }]);

      saveJsonState();

      const delayMs   = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
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
  console.log("ClientMagnet Bot — Dev Job Kit Outreach");
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
