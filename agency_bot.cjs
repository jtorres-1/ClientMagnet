// agency_bot.cjs — ClientMagnet Outreach (CombatIQ - UFC Betting)
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
    { id: "time", title: "Timestamp" },
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
   LEAD SCORING (CombatIQ)
   
   Priority:
   1. BETTING_PICKS (highest intent)
   2. PREDICTION_SEEKING (medium intent)
   3. Betting-specific subs get bonus
========================= */
function scoreLead(p) {
  let score = 0;
  const title = (p.title || "").toLowerCase();

  if (p.leadType === "BETTING_PICKS") score += 5;
  if (p.leadType === "PREDICTION_SEEKING") score += 3;

  // Betting sub bonus
  if (p.subreddit === "MMAbetting" || p.subreddit === "sportsbook") score += 2;
  
  // High-intent keywords
  if (title.includes("parlay") || title.includes("lock")) score += 1;
  if (title.includes("picks") || title.includes("betting on")) score += 1;

  return score;
}

/* =========================
   DM TEMPLATES (CombatIQ)
   
   STRATEGY:
   - Casual, non-salesy tone
   - Frame as "testing a tool" not "buy my product"
   - Lead with results/value
   - Always include link: https://combatiq.app
   - Keep it short (3-4 lines max)
   
   VARIANTS:
   - Template A: AI angle (for betting picks seekers)
   - Template B: Data angle (for prediction seekers)
   - Template C: Free tool angle (general)
========================= */
function getTemplate(post) {
  const trigger = post.matchedTrigger || "picks";
  const templates = [];

  if (post.leadType === "BETTING_PICKS") {
    // Template A: AI-powered picks
    templates.push({
      subject: "Re: your picks post",
      text: `Hey, saw your post in r/${post.subreddit}.

I've been testing an AI tool that breaks down UFC fights with stat comparisons and confidence scores. It's been solid for filtering out bad bets.

Free prediction daily if you want to try it: https://combatiq.app

Not trying to sell anything, just sharing what's been working.`
    });

    // Template B: Results-focused
    templates.push({
      subject: "UFC prediction tool",
      text: `Noticed you're looking for ${trigger} on r/${post.subreddit}.

Been using this AI breakdown tool for UFC cards — pulls fighter stats, gives confidence scores, helps spot value.

1 free prediction per day: https://combatiq.app

Worth checking out if you're tired of guessing.`
    });
  }

  if (post.leadType === "PREDICTION_SEEKING") {
    // Template C: Data/analysis angle
    templates.push({
      subject: "Fight breakdown",
      text: `Saw your question on r/${post.subreddit}.

There's a tool I've been using that does AI-powered fight breakdowns with actual stats (reach, striking %, takedown defense, etc).

Gives you confidence scores so you're not just going off vibes: https://combatiq.app

Free daily prediction if you want to test it out.`
    });
  }

  // Fallback (should not hit, but safety)
  if (templates.length === 0) {
    templates.push({
      subject: "UFC prediction tool",
      text: `Hey, saw your post about UFC betting.

Been using this AI tool for fight predictions — it's actually been helpful for spotting value bets.

Free daily prediction: https://combatiq.app

Not affiliated, just thought it might help.`
    });
  }

  // Randomly pick template to avoid pattern detection
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

  leads = leads
    .filter(l => l.username && l.url && l.leadType)
    .sort((a, b) => scoreLead(b) - scoreLead(a));

  console.log(`Loaded ${leads.length} leads.`);

  let attempted = 0;
  let confirmed = 0;
  const MAX = 8;

  const cycleUsers = new Set();
  const cycleUrls = new Set();

  for (const post of leads) {
    if (attempted >= MAX) break;

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

      await reddit.composeMessage({
        to: rawUser,
        subject: tpl.subject,
        text: tpl.text
      });

      confirmed++;
      console.log(`Sent ${post.leadType} DM → u/${rawUser}`);

      sentUserSet.add(username);
      sentUrlSet.add(url);
      cycleUsers.add(username);
      cycleUrls.add(url);

      await sentWriter.writeRecords([{
        username: rawUser,
        title: post.title,
        url,
        subreddit: post.subreddit,
        leadType: post.leadType,
        time: post.time || new Date().toISOString(),
        status: "OUTREACH"
      }]);

      saveJsonState();

    } catch (err) {
      console.log(`Failed DM to u/${rawUser}: ${err.message}`);
      if (err.message.includes("NOT_WHITELISTED")) {
        sentUserSet.add(username);
        saveJsonState();
      }
    }

    await sleep(25 * 1000 + Math.random() * 20 * 1000);
  }

  console.log(
    `Cycle complete — attempted ${attempted}, confirmed ${confirmed}`
  );
}

/* =========================
   LOOP
========================= */
(async () => {
  await initState();
  while (true) {
    console.log("\n=== New DM cycle: CombatIQ Outreach ===");
    await runCycle();
    await sleep((12 + Math.floor(Math.random() * 8)) * 60 * 1000);
  }
})();
