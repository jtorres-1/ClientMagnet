// agency_bot.cjs — Lead Finder DM Outreach (v4.0, Safe + Rotating Templates)
require("dotenv").config();
const snoowrap = require("snoowrap");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");

// ---- Reddit Client ----
const reddit = new snoowrap({
  userAgent: process.env.REDDIT_USER_AGENT,
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
});

// ---- Mode ----
const mode = process.argv[2] || "lead_finder_clients";

// ---- Absolute File Paths ----
const baseDir = path.resolve(__dirname, "logs");
const leadsPath = path.join(baseDir, `${mode}.csv`);
const sentPath = path.join(baseDir, `${mode}_dmed.csv`);
const sentCachePath = path.join(baseDir, `${mode}_sentCache.json`);

if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

// ---- Persistent Sent Cache (prevents duplicate DMs even after restart) ----
let sentCache = new Set();
if (fs.existsSync(sentCachePath)) {
  try {
    const data = JSON.parse(fs.readFileSync(sentCachePath, "utf8"));
    sentCache = new Set(data);
  } catch {
    sentCache = new Set();
  }
}

// ---- CSV Header Check ----
if (fs.existsSync(leadsPath)) {
  const firstLine = fs.readFileSync(leadsPath, "utf8").split("\n")[0].trim();
  if (!firstLine.toLowerCase().startsWith("username")) {
    console.log("🧠 Adding header to leads CSV...");
    const data = fs.readFileSync(leadsPath, "utf8");
    fs.writeFileSync(leadsPath, "username,title,url,subreddit,time\n" + data);
  }
}

// ---- Sent Log Writer ----
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

// ---- Helper: Load Already Messaged ----
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

// ---- Helper: Load Leads ----
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

// ---- Randomized Message Templates ----
const templates = [
  (post) => ({
    subject: "Saw your post — quick idea for you",
    text: `Hey u/${post.username},

I saw your post in r/${post.subreddit} about “${post.title}.”  
I actually run a service called **Lead Finder** — I personally find real Reddit users asking for help in your niche and deliver them to you as ready-to-contact leads.

Most clients start real convos within 48 hours.  
Here’s the page: https://linktr.ee/jtxcode  

If you want, I can run your first batch within 24 hours.`
  }),

  (post) => ({
    subject: "Quick lead gen tip from Reddit 👀",
    text: `Hey u/${post.username},

I noticed your post about “${post.title}.”  
If you’re trying to get more clients, I can help — I use **Lead Finder**, a system that scrapes Reddit for people *already* asking for what you offer.  

You get a CSV of 50–100 qualified leads ready to DM.  
Details: https://jtxcode.gumroad.com/l/leadfinder  

It’s a simple way to get inbound convos without ads.`
  }),

  (post) => ({
    subject: "Got something that might help you find clients fast",
    text: `Hey u/${post.username},

Noticed your post on r/${post.subreddit}.  
I run **Lead Finder**, a done-for-you Reddit lead sourcing system — it finds posts where people literally say they need help with what you do.

You just choose your niche, and I deliver verified leads in 24 hours.  
More info here: https://jtxcode.gumroad.com/l/leadfinder  

Might save you time doing outreach manually.`
  })
];

// ---- Sleep ----
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- Pick Random Template ----
function getRandomTemplate(post) {
  const random = Math.floor(Math.random() * templates.length);
  return templates[random](post);
}

// ---- One Outreach Cycle ----
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

  const MAX_MESSAGES = 8; // keep under Reddit's limits
  let sentCount = 0;

  for (const post of leads) {
    if (sentCount >= MAX_MESSAGES) break;

    const username = post.username?.trim();
    if (
      !username ||
      alreadySent.has(username) ||
      messagedNow.has(username) ||
      sentCache.has(username)
    )
      continue;

    messagedNow.add(username);
    const msg = getRandomTemplate(post);

    try {
      await reddit.composeMessage({
        to: username,
        subject: msg.subject,
        text: msg.text,
      });
      console.log(`✅ Sent message to u/${username}`);
      await sentWriter.writeRecords([{ ...post, status: "SENT" }]);
      sentCount++;

      sentCache.add(username);
      fs.writeFileSync(sentCachePath, JSON.stringify([...sentCache], null, 2));
    } catch (err) {
      console.log(`⚠️ Failed to message u/${username}: ${err.message}`);
      await sentWriter.writeRecords([{ ...post, status: `ERROR: ${err.message}` }]);
    }

    // Delay between messages (60–120s randomized)
    const delay = 60000 + Math.random() * 60000;
    console.log(`⏳ Waiting ${(delay / 1000).toFixed(0)}s...`);
    await sleep(delay);
  }

  console.log(`✅ Cycle complete. Sent ${sentCount} messages this round.`);
}

// ---- Continuous Loop ----
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
