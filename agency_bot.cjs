// agency_bot.cjs — ClientMagnet Outreach (PAIN primary, HIRING secondary)
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
   LEAD SCORING
========================= */
function scoreLead(p) {
  let score = 0;
  const title = (p.title || "").toLowerCase();

  if (p.leadType === "PAIN") score += 5;
  if (p.leadType === "HIRING") score += 3;

  if (title.includes("manual") || title.includes("automation")) score += 1;
  if (title.includes("stripe") || title.includes("email")) score += 1;
  if (p.subreddit === "forhire" || p.subreddit === "jobbit") score += 1;

  return score;
}

/* =========================
   DM TEMPLATES
========================= */
function getTemplate(post) {
  const trigger = post.matchedTrigger || "that";

  if (post.leadType === "PAIN") {
    return {
      subject: "Quick question",
      text: `Hey u/${post.username},

Saw your post about ${trigger} in r/${post.subreddit}.
Quick question — are you still dealing with that, or did you find a fix?

I’ve helped teams automate similar workflows before.
Happy to share what usually works if it’s helpful.

– Jesse`
    };
  }

  // HIRING fallback
  return {
    subject: "Quick dev help",
    text: `Hey u/${post.username},

Saw your post in r/${post.subreddit}.
I’ve built similar systems and can help quickly.

If you want, share scope + timeline and I’ll confirm pricing.

– Jesse`
  };
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
    console.log("\n=== New DM cycle: ClientMagnet Outreach ===");
    await runCycle();
    await sleep((12 + Math.floor(Math.random() * 8)) * 60 * 1000);
  }
})();
