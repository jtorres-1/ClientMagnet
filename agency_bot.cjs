// agency_bot.cjs Lead Finder DM Outreach v6 buyers plus sellers
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

// Mode maps to CSV
// use lead_finder_buyers or lead_finder_sellers
const mode = process.argv[2] || "lead_finder_buyers";

// Paths
const baseDir = path.resolve(__dirname, "logs");
const leadsPath = path.join(baseDir, `${mode}.csv`);
const sentPath = path.join(baseDir, `${mode}_dmed.csv`);
const sentStatePath = path.join(baseDir, `${mode}_sentState.json`);

if (!fs.existsSync(baseDir)) {
  fs.mkdirSync(baseDir, { recursive: true });
}

// Global state
let sentUrlSet = new Set();
let sentUserSet = new Set();
let initialized = false;

// Sent log writer
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

// Sleep
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Load sent state from JSON
function loadSentStateFromJson() {
  if (!fs.existsSync(sentStatePath)) return;

  try {
    const raw = fs.readFileSync(sentStatePath, "utf8");
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      parsed.forEach((u) => sentUrlSet.add(String(u).trim()));
    } else if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.urls)) {
        parsed.urls.forEach((u) => sentUrlSet.add(String(u).trim()));
      }
      if (Array.isArray(parsed.usernames)) {
        parsed.usernames.forEach((u) =>
          sentUserSet.add(String(u).trim().toLowerCase())
        );
      }
    }
  } catch (e) {
    console.log("Failed to parse sentState JSON starting fresh", e.message);
  }
}

// Save sent state to JSON
function saveSentStateToJson() {
  const data = {
    urls: [...sentUrlSet],
    usernames: [...sentUserSet],
  };

  fs.writeFileSync(sentStatePath, JSON.stringify(data, null, 2));
}

// Load sent state from CSV
function loadSentStateFromCsv() {
  return new Promise((resolve) => {
    if (!fs.existsSync(sentPath)) return resolve();

    const stream = fs.createReadStream(sentPath).pipe(csv());
    stream
      .on("data", (row) => {
        const username = (row.username || "").trim().toLowerCase();
        const url = (row.url || "").trim();

        if (username) sentUserSet.add(username);
        if (url) sentUrlSet.add(url);
      })
      .on("end", () => resolve())
      .on("error", () => resolve());
  });
}

// Load leads CSV
function loadLeads() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(leadsPath)) return resolve([]);

    const leads = [];
    fs.createReadStream(leadsPath)
      .pipe(csv())
      .on("data", (row) => leads.push(row))
      .on("end", () => resolve(leads))
      .on("error", (err) => reject(err));
  });
}

// Buyer templates
const buyerTemplates = [
  (post) => ({
    subject: "Quick idea for you",
    text: `Hey u/${post.username},

Saw your post in r/${post.subreddit} about “${post.title}.”
I run a small service called Lead Finder that finds real Reddit users asking for help in your niche.

Most people get replies within a day.
Here is the page: https://linktr.ee/jtxcode`,
  }),
  (post) => ({
    subject: "Saw your post",
    text: `Hey u/${post.username},

I noticed your post about “${post.title}.”
I help people get clients by pulling Reddit users who are already looking for what they offer.

If you want to check it out here is the page:
https://linktr.ee/jtxcode`,
  }),
  (post) => ({
    subject: "This might help you",
    text: `Hey u/${post.username},

Saw your post in r/${post.subreddit}.
I run Lead Finder, a done for you system that finds Reddit posts where people literally say they need help.

If you want to see how it works:
https://linktr.ee/jtxcode`,
  }),
];

// Seller templates authority tone
const sellerTemplates = [
  (post) => ({
    subject: "More clients from Reddit",
    text: `Hey u/${post.username},

Saw your post in r/${post.subreddit} about “${post.title}.”
I help freelancers and agencies get more clients using Reddit buyer intent scraping.

Lead Finder pulls posts from people already asking for the services you offer.
You can see it here: https://linktr.ee/jtxcode`,
  }),
  (post) => ({
    subject: "Client idea for your services",
    text: `Hey u/${post.username},

I noticed your post offering services in r/${post.subreddit}.
I run Lead Finder, which tracks Reddit threads where people say they need marketing dev or automation help.

Most users plug it in to fill their pipeline faster.
Here is the page: https://linktr.ee/jtxcode`,
  }),
  (post) => ({
    subject: "Way to fill your pipeline",
    text: `Hey u/${post.username},

You are clearly offering services with that “${post.title}” post.
My tool Lead Finder finds Reddit users who are already asking for what you sell so you are not chasing cold leads.

If you want to see how it works:
https://linktr.ee/jtxcode`,
  }),
];

function getRandomTemplate(post) {
  const isBuyerMode = mode === "lead_finder_buyers";
  const isSellerMode = mode === "lead_finder_sellers";

  let pool = buyerTemplates;
  if (isSellerMode) pool = sellerTemplates;
  if (!isBuyerMode && !isSellerMode) pool = buyerTemplates;

  return pool[Math.floor(Math.random() * pool.length)](post);
}

// Init sent state
async function initState() {
  if (initialized) return;

  console.log("Initializing sent state");
  loadSentStateFromJson();
  await loadSentStateFromCsv();

  console.log(
    `Loaded ${sentUrlSet.size} sent URLs and ${sentUserSet.size} sent usernames for mode ${mode}`
  );
  initialized = true;
}

// One DM cycle
async function runCycle() {
  if (!fs.existsSync(leadsPath)) {
    console.log(`No leads file found at ${leadsPath}`);
    return;
  }

  const leads = await loadLeads();
  if (!leads.length) {
    console.log("No leads found in CSV");
    return;
  }

  const cycleUrlSet = new Set();
  const cycleUserSet = new Set();

  console.log(
    `Loaded ${leads.length} leads global sent ${sentUrlSet.size} urls ${sentUserSet.size} users`
  );

  const MAX_MESSAGES = 8;
  let sentCount = 0;

  for (const post of leads) {
    if (sentCount >= MAX_MESSAGES) break;

    const usernameRaw = (post.username || "").trim();
    const username = usernameRaw.toLowerCase();
    const urlKey = (post.url || "").trim();

    if (!username || !urlKey) continue;

    if (sentUserSet.has(username)) continue;
    if (sentUrlSet.has(urlKey)) continue;
    if (cycleUserSet.has(username)) continue;
    if (cycleUrlSet.has(urlKey)) continue;

    const msg = getRandomTemplate(post);

    try {
      await reddit.composeMessage({
        to: usernameRaw,
        subject: msg.subject,
        text: msg.text,
      });

      sentCount++;
      cycleUserSet.add(username);
      cycleUrlSet.add(urlKey);
      sentUserSet.add(username);
      sentUrlSet.add(urlKey);
      saveSentStateToJson();

      console.log(`Sent message to u/${usernameRaw} [${sentCount}/${MAX_MESSAGES}]`);

      await sentWriter.writeRecords([
        {
          username: usernameRaw,
          title: post.title || "",
          url: urlKey,
          subreddit: post.subreddit || "",
          time: post.time || new Date().toISOString(),
          status: "SENT",
        },
      ]);
    } catch (err) {
      console.log(`Failed to message u/${usernameRaw}: ${err.message}`);
      await sentWriter.writeRecords([
        {
          username: usernameRaw,
          title: post.title || "",
          url: urlKey,
          subreddit: post.subreddit || "",
          time: post.time || new Date().toISOString(),
          status: `ERROR: ${err.message}`,
        },
      ]);
    }

    const delay = 60000 + Math.random() * 60000;
    console.log(`Waiting ${(delay / 1000).toFixed(0)} seconds`);
    await sleep(delay);
  }

  const timestamp = new Date().toLocaleString();
  console.log(
    `Cycle complete ${timestamp} mode ${mode} total messages this round ${sentCount}\n`
  );
}

// Continuous loop
(async () => {
  await initState();

  while (true) {
    console.log(`Starting new Lead Finder outreach cycle mode ${mode}`);
    try {
      await runCycle();
    } catch (err) {
      console.error("Cycle crashed", err);
    }

    const waitMins = 25 + Math.floor(Math.random() * 15);
    console.log(`Sleeping ${waitMins} minutes before next cycle\n`);
    await sleep(waitMins * 60 * 1000);
  }
})();
