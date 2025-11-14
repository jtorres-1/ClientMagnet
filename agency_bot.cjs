// agency_bot.cjs — Lead Finder DM Outreach (v4.1, Safe + Accurate Counter)
require("dotenv").config();
const snoowrap = require("snoowrap");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");

// Reddit Client
const reddit = new snoowrap({
  userAgent: process.env.REDDIT_USER_AGENT,
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
});

// Mode
const mode = process.argv[2] || "lead_finder_clients";

// Paths
const baseDir = path.resolve(__dirname, "logs");
const leadsPath = path.join(baseDir, `${mode}.csv`);
const sentPath = path.join(baseDir, `${mode}_dmed.csv`);
const sentCachePath = path.join(baseDir, `${mode}_sentCache.json`);

if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

// Cache
let sentCache = new Set();
if (fs.existsSync(sentCachePath)) {
  try {
    const data = JSON.parse(fs.readFileSync(sentCachePath, "utf8"));
    sentCache = new Set(data);
  } catch {
    sentCache = new Set();
  }
}

// CSV Header Check
if (fs.existsSync(leadsPath)) {
  const firstLine = fs.readFileSync(leadsPath, "utf8").split("\n")[0].trim();
  if (!firstLine.toLowerCase().startsWith("username")) {
    console.log("🧠 Adding header to leads CSV...");
    const data = fs.readFileSync(leadsPath, "utf8");
    fs.writeFileSync(leadsPath, "username,title,url,subreddit,time\n" + data);
  }
}

// Sent Log Writer
const sentWriter = createObjectCsvWriter({
  path: sentPath,
  header: [
    { id: "username", title: "Username" },
    { id: "title", title: "Post Title" },
    { id: "url", title: "Post URL" },
    { id: "subreddit", title: "Subreddit" },
    { id: "time", title: "Timestamp" },
    { id: "status", title: "Status" },
  ],
  append: true,
});

// Helper Functions
function getMessagedUsernames() {
  if (!fs.existsSync(sentPath)) return new Set();
  const data = fs.readFileSync(sentPath, "utf8");
  const lines = data.split("\n").slice(1);
  const names = new Set();
  for (const l of lines) {
    const user = l.split(",")[0];
    if (user) names.add(user.trim());
  }
  return names;
}

function loadLeads() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(leadsPath)) return resolve([]);
    const leads = [];
    fs.createReadStream(leadsPath)
      .pipe(csv())
      .on("data", (row) => leads.push(row))
      .on("end", () => resolve(leads))
      .on("error", reject);
  });
}

// Templates (Linktree Included)
const templates = [
  (post) => ({
    subject: "Quick idea for you",
    text: `Hey u/${post.username},

Saw your post in r/${post.subreddit} about “${post.title}.”  
I run a small service called Lead Finder that finds real Reddit users asking for help in your niche.

Most people get replies within a day.  
Here’s the page: https://linktr.ee/jtxcode`
  }),

  (post) => ({
    subject: "Saw your post",
    text: `Hey u/${post.username},

I noticed your post about “${post.title}.”  
I help people get clients by pulling Reddit users who are already looking for what they offer.

If you want to check it out, here’s the page: https://linktr.ee/jtxcode`
  }),

  (post) => ({
    subject: "This might help you",
    text: `Hey u/${post.username},

Saw your post in r/${post.subreddit}.  
I run Lead Finder, a done for you system that finds Reddit posts where people literally say they need help.

If you want to see how it works: https://linktr.ee/jtxcode`
  }),
];

// Sleep
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getRandomTemplate(post) {
  return templates[Math.floor(Math.random() * templates.length)](post);
}

// Main Loop
async function runCycle() {
  if (!fs.existsSync(leadsPath)) {
    console.log(`❌ No leads file found at ${leadsPath}`);
    return;
  }

  const leads = await loadLeads();
  const alreadySent = getMessagedUsernames();
  const messagedNow = new Set();

  console.log(
    `📬 Loaded ${leads.length} leads (${alreadySent.size} already in CSV, ${sentCache.size} cached globally)`
  );

  const MAX_MESSAGES = 8;
  let sentCount = 0;

  for (const post of leads) {
    if (sentCount >= MAX_MESSAGES) break;
    const username = post.username?.trim();
    if (!username || alreadySent.has(username) || messagedNow.has(username) || sentCache.has(username)) continue;

    messagedNow.add(username);
    const msg = getRandomTemplate(post);

    try {
      await reddit.composeMessage({
        to: username,
        subject: msg.subject,
        text: msg.text,
      });

      sentCount++;
      console.log(`✅ [${sentCount}/${MAX_MESSAGES}] Sent message to u/${username}`);
      await sentWriter.writeRecords([{ ...post, status: "SENT" }]);

      sentCache.add(username);
      fs.writeFileSync(sentCachePath, JSON.stringify([...sentCache], null, 2));
    } catch (err) {
      console.log(`⚠️ Failed to message u/${username}: ${err.message}`);
      await sentWriter.writeRecords([{ ...post, status: `ERROR: ${err.message}` }]);
    }

    const delay = 60000 + Math.random() * 60000;
    console.log(`⏳ Waiting ${(delay / 1000).toFixed(0)}s...`);
    await sleep(delay);
  }

  const timestamp = new Date().toLocaleString();
  console.log(`✅ Cycle complete (${timestamp}). Total messages sent this round: ${sentCount}\n`);
}

// Continuous Loop
(async () => {
  while (true) {
    console.log("🕒 Starting new Lead Finder outreach cycle...");
    try {
      await runCycle();
    } catch (err) {
      console.error("💥 Cycle crashed:", err);
    }

    const waitMins = 25 + Math.floor(Math.random() * 15);
    console.log(`💤 Sleeping ${waitMins} min before next cycle...\n`);
    await sleep(waitMins * 60 * 1000);
  }
})();
