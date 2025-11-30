// agency_bot.cjs — CombatIQ DM Outreach Edition (DM-Skip Safe Edition)
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

// Memory tracking
let sentUrlSet = new Set();
let sentUserSet = new Set();
let initialized = false;

// CSV Writer
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

// Load JSON memory for sent users + URLs
function loadJsonState() {
  if (!fs.existsSync(sentStatePath)) return;

  try {
    const data = JSON.parse(fs.readFileSync(sentStatePath, "utf8"));

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

// Save JSON memory
function saveJsonState() {
  const data = {
    urls: [...sentUrlSet],
    usernames: [...sentUserSet],
  };
  fs.writeFileSync(sentStatePath, JSON.stringify(data, null, 2));
}

// Load CSV "sent" state
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

// ===============================
// CombatIQ Promotion Templates
// ===============================
const buyerTemplates = [
  (p) => ({
    subject: "Quick UFC prediction tool",
    text: `Hey u/${p.username},

Saw your post in r/${p.subreddit} about “${p.title}.”
I built an AI UFC predictor that gives full breakdowns, stat comparisons, and over/under analysis.

It’s free to use here:
https://combatiq.app`,
  }),

  (p) => ({
    subject: "Free AI fight predictor",
    text: `Hey u/${p.username},

Saw your post about “${p.title}.”
If you make picks or parlays, this might help — Combat IQ gives AI scoring and full matchup breakdowns.

Try it here:
https://combatiq.app`,
  }),

  (p) => ({
    subject: "This might help with your picks",
    text: `Hey u/${p.username},

Noticed your post in r/${p.subreddit}.
I made a tool called Combat IQ — you type any matchup and it gives a full AI breakdown + confidence score.

Free link:
https://combatiq.app`,
  }),
];

// Pick random template
const getTemplate = (post) =>
  buyerTemplates[Math.floor(Math.random() * buyerTemplates.length)](post);

// Initialize full bot memory
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

    const rawUser = (post.username || "").trim();
    const username = rawUser.toLowerCase();
    const url = (post.url || "").trim();

    if (!username || !url) continue;

    // HARD skip rules (never DM same user twice)
    if (sentUserSet.has(username)) continue;
    if (sentUrlSet.has(url)) continue;
    if (cycleUserSet.has(username)) continue;
    if (cycleUrlSet.has(url)) continue;

    const msg = getTemplate(post);

    try {
      await reddit.composeMessage({
        to: rawUser,
        subject: msg.subject,
        text: msg.text,
      });

      sent++;
      console.log(`Sent DM to u/${rawUser} [${sent}/${MAX}]`);

      sentUserSet.add(username);
      sentUrlSet.add(url);
      cycleUserSet.add(username);
      cycleUrlSet.add(url);

      await sentWriter.writeRecords([
        {
          username: rawUser,
          title: post.title,
          url: url,
          subreddit: post.subreddit,
          time: post.time || new Date().toISOString(),
          status: "SENT",
        },
      ]);

      saveJsonState();
    } catch (err) {
      console.log(`Failed to DM u/${rawUser}: ${err.message}`);

      // Skip users who cannot receive DMs
      if (
        err.message.includes("NOT_WHITELISTED_BY_USER_MESSAGE") ||
        err.message.includes("USER_DOESNT_ALLOW_DMS") ||
        err.message.includes("RATELIMIT") ||
        err.message.includes("403")
      ) {
        console.log(`Skipping u/${rawUser} forever — cannot be DMed`);

        sentUserSet.add(username);
        sentUrlSet.add(url);
        saveJsonState();

        await sentWriter.writeRecords([
          {
            username: rawUser,
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
          username: rawUser,
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

// Loop forever
(async () => {
  await initState();

  while (true) {
    console.log(`\n=== New DM cycle: CLEAN LEADS (Combat IQ) ===`);
    await runCycle();

    const mins = 30 + Math.floor(Math.random() * 20);
    console.log(`Sleeping ${mins} minutes...\n`);
    await sleep(mins * 60 * 1000);
  }
})();
