// agency_bot.cjs — ClientMagnet Dev Gig Outreach (STRICT BUYERS)
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

// MODE
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

// CSV Writer
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

// Load sent state
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

/* ============================================
   HIGH INTENT DEV DM TEMPLATE
============================================ */
const getTemplate = (p) => ({
  subject: "Quick dev question",
  text: `Hey u/${p.username},

Saw your post about ${p.matchedTrigger || "needing a developer"} in r/${p.subreddit}.

I do this type of work and can usually scope it fast.
If you want, tell me what you're trying to build and timeline and I’ll let you know cost.

Jesse`
});

// Init
async function initState() {
  if (initialized) return;
  loadJsonState();
  await loadCsvState();
  console.log(`Loaded state — ${sentUserSet.size} users, ${sentUrlSet.size} URLs`);
  initialized = true;
}

// DM cycle
async function runCycle() {
  const leads = await loadLeads();
  if (!leads.length) {
    console.log("No leads available.");
    return;
  }

  console.log(`Loaded ${leads.length} leads.`);

  let sent = 0;
  const MAX = 5;
  const cycleUsers = new Set();
  const cycleUrls = new Set();

  for (const post of leads) {
    if (sent >= MAX) break;

    const rawUser = (post.username || "").trim();
    const username = rawUser.toLowerCase();
    const url = (post.url || "").trim();

    if (!rawUser || !url) continue;
    if (sentUserSet.has(username)) continue;
    if (sentUrlSet.has(url)) continue;
    if (cycleUsers.has(username)) continue;
    if (cycleUrls.has(url)) continue;
    if (post.leadType !== "DEV-GIG") continue;

    const msg = getTemplate(post);

    try {
      await reddit.composeMessage({
        to: rawUser,
        subject: msg.subject,
        text: msg.text
      });

      console.log(`Sent DM to u/${rawUser}`);
      sent++;

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
      sentUserSet.add(username);
      sentUrlSet.add(url);
      saveJsonState();
    }

    await sleep(60000 + Math.random() * 60000);
  }

  console.log(`Cycle complete — sent ${sent} messages.`);
}

// Loop
(async () => {
  await initState();
  while (true) {
    console.log("\n=== New DM cycle: ClientMagnet Dev Outreach ===");
    await runCycle();
    await sleep((45 + Math.floor(Math.random() * 30)) * 60 * 1000);
  }
})();
