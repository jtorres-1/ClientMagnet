// agency_bot.cjs — Lead Finder DM Outreach v10 (DM-Skip Safe Edition)
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

// FORCE MODE TO CLEAN LEADS ONLY
const mode = "clean_leads";

// Paths
const baseDir = path.resolve(__dirname, "logs");
const leadsPath = path.join(baseDir, `${mode}.csv`);
const sentPath = path.join(baseDir, `${mode}_dmed.csv`);
const sentStatePath = path.join(baseDir, `${mode}_sentState.json`);

if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

// Memory
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Load JSON memory
function loadJsonState() {
  if (!fs.existsSync(sentStatePath)) return;

  try {
    const raw = fs.readFileSync(sentStatePath, "utf8");
    const data = JSON.parse(raw);

    if (Array.isArray(data)) {
      data.forEach((v) => sentUrlSet.add(v.trim()));
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

// Save JSON
function saveJsonState() {
  const data = {
    urls: [...sentUrlSet],
    usernames: [...sentUserSet],
  };

  fs.writeFileSync(sentStatePath, JSON.stringify(data, null, 2));
}

// Load sent CSV log
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

// Load leads
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

// Buyer templates
const buyerTemplates = [
  (p) => ({
    subject: "Quick idea for you",
    text: `Hey u/${p.username},

Saw your post in r/${p.subreddit} about “${p.title}.”
I run a tool called Lead Finder that finds Reddit users already asking for what you offer.

Here’s the page:
https://linktr.ee/jtxcode`,
  }),
  (p) => ({
    subject: "Saw your post",
    text: `Hey u/${p.username},

I noticed your post about “${p.title}.”
I help people get clients by pulling Reddit users who literally request those services.

Here’s the page:
https://linktr.ee/jtxcode`,
  }),
  (p) => ({
    subject: "This might help",
    text: `Hey u/${p.username},

Saw your post in r/${p.subreddit}.
Lead Finder finds Reddit users who openly say they need help.

Here’s the page:
https://linktr.ee/jtxcode`,
  }),
];

const getTemplate = (post) =>
  buyerTemplates[Math.floor(Math.random() * buyerTemplates.length)](post);

// Init
async function initState() {
  if (initialized) return;

  console.log("Initializing state...");

  loadJsonState();
  await loadCsvState();

  console.log(
    `Loaded state — ${sentUserSet.size} users, ${sentUrlSet.size} URLs`
  );

  initialized = true;
}

// DM cycle
async function runCycle() {
  if (!fs.existsSync(leadsPath)) {
    console.log("No clean_leads.csv found.");
    return;
  }

  const leads = await loadLeads();
  if (!leads.length) {
    console.log("Clean leads CSV is empty.");
    return;
  }

  console.log(`Loaded ${leads.length} clean leads.`);

  let sent = 0;
  const MAX = 8;

  const cycleUserSet = new Set();
  const cycleUrlSet = new Set();

  for (const post of leads) {
    if (sent >= MAX) break;

    const usernameRaw = (post.username || "").trim();
    const username = usernameRaw.toLowerCase();
    const url = (post.url || "").trim();

    if (!username || !url) continue;

    // HARD skip rules — NEVER DM someone twice
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

      // NEW LOGIC — SKIP USERS WHO CANNOT BE DMED
      if (
        err.message.includes("NOT_WHITELISTED_BY_USER_MESSAGE") ||
        err.message.includes("USER_DOESNT_ALLOW_DMS") ||
        err.message.includes("RATELIMIT") ||
        err.message.includes("403")
      ) {
        console.log(`Skipping u/${usernameRaw} forever — cannot be DMed`);

        sentUserSet.add(username);
        sentUrlSet.add(url);
        saveJsonState();

        await sentWriter.writeRecords([
          {
            username: usernameRaw,
            title: post.title,
            url: url,
            subreddit: post.subreddit,
            time: post.time || new Date().toISOString(),
            status: `SKIPPED: ${err.message}`,
          },
        ]);

        continue;
      }

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

  console.log(`Cycle complete — sent ${sent} messages.`);
}

// Loop
(async () => {
  await initState();

  while (true) {
    console.log(`\n=== New DM cycle: CLEAN LEADS ===`);
    await runCycle();

    const mins = 30 + Math.floor(Math.random() * 20);
    console.log(`Sleeping ${mins} minutes...\n`);
    await sleep(mins * 60 * 1000);
  }
})();
