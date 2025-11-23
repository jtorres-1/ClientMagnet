// agency_bot.cjs — Lead Finder DM Outreach v7 (Buyers + Sellers)
require("dotenv").config();
const snoowrap = require("snoowrap");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");

// Reddit client
const reddit = new snoowrap({
  userAgent: process.env.REDDIT_USER_AGENT,
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
});

// MODE — lead_finder_buyers or lead_finder_sellers
const mode = process.argv[2] || "lead_finder_buyers";

// Paths
const baseDir = path.resolve(__dirname, "logs");
const leadsPath = path.join(baseDir, `${mode}.csv`);
const sentPath = path.join(baseDir, `${mode}_dmed.csv`);
const sentStatePath = path.join(baseDir, `${mode}_sentState.json`);

if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

// Global memory
let sentUrlSet = new Set();
let sentUserSet = new Set();
let initialized = false;

// Writer
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

// Sleep helper
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Load JSON sent-state
function loadJsonState() {
  if (!fs.existsSync(sentStatePath)) return;

  try {
    const raw = fs.readFileSync(sentStatePath, "utf8");
    const data = JSON.parse(raw);

    if (Array.isArray(data)) {
      data.forEach((val) => sentUrlSet.add(val.trim()));
      return;
    }

    if (data.urls) data.urls.forEach((u) => sentUrlSet.add(u.trim()));
    if (data.usernames)
      data.usernames.forEach((u) =>
        sentUserSet.add(u.trim().toLowerCase())
      );

  } catch (err) {
    console.log("Error loading JSON state:", err.message);
  }
}

// Save JSON state
function saveJsonState() {
  const data = {
    urls: [...sentUrlSet],
    usernames: [...sentUserSet],
  };

  fs.writeFileSync(sentStatePath, JSON.stringify(data, null, 2));
}

// Load CSV sent-state
function loadCsvState() {
  return new Promise((resolve) => {
    if (!fs.existsSync(sentPath)) return resolve();

    fs.createReadStream(sentPath)
      .pipe(csv())
      .on("data", (row) => {
        const u = (row.username || "").trim().toLowerCase();
        const url = (row.url || "").trim();
        if (u) sentUserSet.add(u);
        if (url) sentUrlSet.add(url);
      })
      .on("end", resolve)
      .on("error", resolve);
  });
}

// Load leads from CSV
function loadLeads() {
  return new Promise((resolve) => {
    if (!fs.existsSync(leadsPath)) return resolve([]);
    const arr = [];
    fs.createReadStream(leadsPath)
      .pipe(csv())
      .on("data", (row) => arr.push(row))
      .on("end", () => resolve(arr))
      .on("error", () => resolve(arr));
  });
}

// Buyer templates — Linktree included
const buyerTemplates = [
  (post) => ({
    subject: "Quick idea for you",
    text: `Hey u/${post.username},

Saw your post in r/${post.subreddit} about “${post.title}.”
I run a small tool called Lead Finder that finds real Reddit users asking for exactly what you need.

Most people get replies within a day.
Here is the page:
https://linktr.ee/jtxcode`,
  }),
  (post) => ({
    subject: "Saw your post",
    text: `Hey u/${post.username},

I noticed your post about “${post.title}.”
I help people get clients by finding Reddit users who already want those services.

If you want to check it out:
https://linktr.ee/jtxcode`,
  }),
  (post) => ({
    subject: "This might help",
    text: `Hey u/${post.username},

Saw your post in r/${post.subreddit}.
Lead Finder pulls Reddit posts where buyers literally ask for help.

Here is the page:
https://linktr.ee/jtxcode`,
  }),
];

// Seller templates — Linktree included
const sellerTemplates = [
  (post) => ({
    subject: "More clients for your services",
    text: `Hey u/${post.username},

Saw your post about “${post.title}.”
I help agencies and freelancers get clients through Reddit buyer-intent scraping.

Lead Finder pulls posts from users already asking for services like yours:
https://linktr.ee/jtxcode`,
  }),
  (post) => ({
    subject: "Potential client boost",
    text: `Hey u/${post.username},

Your post in r/${post.subreddit} caught my eye.
My tool Lead Finder scans Reddit for people who need marketing dev or automation help.

You can check it here:
https://linktr.ee/jtxcode`,
  }),
  (post) => ({
    subject: "Fill your pipeline faster",
    text: `Hey u/${post.username},

Your “${post.title}” post shows you offer services.
I run Lead Finder which finds Reddit buyers who are already asking for those services.

Here is the page:
https://linktr.ee/jtxcode`,
  }),
];

function getTemplate(post) {
  if (mode === "lead_finder_sellers") return sellerTemplates[Math.floor(Math.random() * sellerTemplates.length)](post);
  return buyerTemplates[Math.floor(Math.random() * buyerTemplates.length)](post);
}

// Initialize global state
async function initState() {
  if (initialized) return;

  console.log("Initializing state...");

  loadJsonState();
  await loadCsvState();

  console.log(
    `Loaded state — ${sentUserSet.size} users and ${sentUrlSet.size} URLs skipped`
  );

  initialized = true;
}

// DM Cycle
async function runCycle() {
  if (!fs.existsSync(leadsPath)) {
    console.log("No leads file found, skipping...");
    return;
  }

  const leads = await loadLeads();
  if (!leads.length) {
    console.log("Leads CSV empty");
    return;
  }

  console.log(`Loaded ${leads.length} leads from CSV`);

  let sent = 0;
  const MAX = 8;
  let cycleUserSet = new Set();
  let cycleUrlSet = new Set();

  for (const post of leads) {
    if (sent >= MAX) break;

    const usernameRaw = (post.username || "").trim();
    const username = usernameRaw.toLowerCase();
    const url = (post.url || "").trim();

    if (!username || !url) continue;

    if (sentUserSet.has(username)) continue;
    if (sentUrlSet.has(url)) continue;
    if (cycleUserSet.has(username)) continue;
    if (cycleUrlSet.has(url)) continue;

    const msg = getTemplate(post);

    try {
      await reddit.composeMessage({
        to: usernameRaw,
        subject: msg.subject,
        text: msg.text,
      });

      sent++;
      console.log(`Sent DM to u/${usernameRaw} [${sent}/${MAX}]`);

      sentUserSet.add(username);
      sentUrlSet.add(url);
      cycleUserSet.add(username);
      cycleUrlSet.add(url);

      await sentWriter.writeRecords([
        {
          username: usernameRaw,
          title: post.title,
          url: url,
          subreddit: post.subreddit,
          time: post.time || new Date().toISOString(),
          status: "SENT",
        },
      ]);

      saveJsonState();

    } catch (err) {
      console.log(`Failed to DM u/${usernameRaw}: ${err.message}`);

      await sentWriter.writeRecords([
        {
          username: usernameRaw,
          title: post.title,
          url: url,
          subreddit: post.subreddit,
          time: post.time || new Date().toISOString(),
          status: `ERROR: ${err.message}`,
        },
      ]);
    }

    const delay = 45000 + Math.random() * 60000;
    console.log(`Waiting ${(delay / 1000).toFixed(0)} sec...`);
    await sleep(delay);
  }

  console.log(`Cycle complete — sent ${sent} messages`);
}

// Loop forever
(async () => {
  await initState();

  while (true) {
    console.log(`\n=== New DM cycle: ${mode} ===`);
    await runCycle();

    const mins = 30 + Math.floor(Math.random() * 20);
    console.log(`Sleeping ${mins} minutes...\n`);
    await sleep(mins * 60 * 1000);
  }
})();
