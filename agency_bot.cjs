// agency_bot.cjs — ClientMagnet Dev Gig Outreach (PATCHED)
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
   MODE + PATHS
========================= */
const mode = "clean_leads";
const baseDir = path.resolve(__dirname, "logs");
const leadsPath = path.join(baseDir, `${mode}.csv`);
const sentPath = path.join(baseDir, `${mode}_dmed.csv`);
const sentStatePath = path.join(baseDir, `${mode}_sentState.json`);
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

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
    if (data.usernames) data.usernames.forEach(u => sentUserSet.add(u.toLowerCase()));
  } catch {}
}

function saveJsonState() {
  fs.writeFileSync(
    sentStatePath,
    JSON.stringify({ urls: [...sentUrlSet], usernames: [...sentUserSet] }, null, 2)
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
   LEAD PRIORITIZATION
========================= */
function scoreLead(p) {
  let score = 0;
  const t = (p.title || "").toLowerCase();
  if (t.includes("$") || t.includes("paid") || t.includes("budget")) score += 3;
  if (p.subreddit === "jobbit" || p.subreddit === "forhire") score += 2;
  if (t.includes("need") || t.includes("looking")) score += 1;
  return score;
}

/* =========================
   DM TEMPLATE
========================= */
const getTemplate = (p) => ({
  subject: "Quick dev help",
  text: `Hey u/${p.username},

Saw your post in r/${p.subreddit}.
I build this type of thing and can start today.

If you want, tell me scope + timeline and I’ll confirm price fast.

Jesse`
});

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

  // PRIORITIZE
  leads = leads
    .filter(l => l.username && l.url)
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
      await reddit.composeMessage({
        to: rawUser,
        subject: getTemplate(post).subject,
        text: getTemplate(post).text
      });

      confirmed++;
      console.log(`Sent DM to u/${rawUser}`);

      sentUserSet.add(username);
      sentUrlSet.add(url);
      cycleUsers.add(username);
      cycleUrls.add(url);

      await sentWriter.writeRecords([{
        username: rawUser,
        title: post.title,
        url,
        subreddit: post.subreddit,
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
    `Cycle complete — attempted ${attempted}, confirmed ${confirmed} messages.`
  );
}

/* =========================
   LOOP
========================= */
(async () => {
  await initState();
  while (true) {
    console.log("\n=== New DM cycle: ClientMagnet Dev Outreach ===");
    await runCycle();
    await sleep((12 + Math.floor(Math.random() * 8)) * 60 * 1000);
  }
})();
