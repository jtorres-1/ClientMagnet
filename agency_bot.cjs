// agency_bot.cjs — Reddit DM Bot Sales Outreach (Auto + Safe)
require("dotenv").config();
const snoowrap = require("snoowrap");
const fs = require("fs");
const csv = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");

const reddit = new snoowrap({
  userAgent: process.env.REDDIT_USER_AGENT,
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
});

const mode = process.argv[2] || "automation_clients";
const leadsPath = `logs/${mode}.csv`;
const sentPath = `logs/${mode}_dmed.csv`;

// --- CSV prep ---
if (fs.existsSync(leadsPath)) {
  const firstLine = fs.readFileSync(leadsPath, "utf8").split("\n")[0].trim();
  if (!firstLine.toLowerCase().startsWith("username")) {
    console.log("🧠 Adding header to leads CSV...");
    const data = fs.readFileSync(leadsPath, "utf8");
    fs.writeFileSync(leadsPath, "username,title,url,subreddit,time\n" + data);
  }
}

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
    const leads = [];
    fs.createReadStream(leadsPath)
      .pipe(csv())
      .on("data", (row) => leads.push(row))
      .on("end", () => resolve(leads))
      .on("error", reject);
  });
}

function buildMessage(post) {
  return {
    subject: "Saw your post — quick automation idea",
    text: `Hey u/${post.username},

I saw your post in r/${post.subreddit} about “${post.title}”.
I’ve built a ready-to-use Reddit DM automation tool that handles outreach and lead generation — perfect for tasks like yours.

👉 https://linktr.ee/jtxcode

It’s plug-and-play and built for safe Reddit automation.
– Jesse (Automation Developer)`,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runCycle() {
  if (!fs.existsSync(leadsPath)) {
    console.log(`❌ No leads file found at ${leadsPath}`);
    return;
  }

  const leads = await loadLeads();
  const alreadySent = getMessagedUsernames();
  const messagedNow = new Set();

  console.log(`📬 Loaded ${leads.length} leads (${alreadySent.size} already messaged)`);

  const MAX_MESSAGES = 8;
  let sentCount = 0;

  for (const post of leads) {
    if (sentCount >= MAX_MESSAGES) break;

    const username = post.username?.trim();
    if (!username || alreadySent.has(username) || messagedNow.has(username)) continue;

    messagedNow.add(username);
    const msg = buildMessage(post);

    try {
      await reddit.composeMessage({
        to: username,
        subject: msg.subject,
        text: msg.text,
      });
      console.log(`✅ Sent message to u/${username}`);
      await sentWriter.writeRecords([{ ...post, status: "SENT" }]);
      sentCount++;
    } catch (err) {
      console.log(`⚠️ Failed to message u/${username}: ${err.message}`);
      await sentWriter.writeRecords([{ ...post, status: `ERROR: ${err.message}` }]);
    }

    const delay = 45000 + Math.random() * 45000;
    console.log(`⏳ Waiting ${(delay / 1000).toFixed(0)}s...`);
    await sleep(delay);
  }

  console.log(`Cycle complete. Sent ${sentCount} messages.`);
}

// --- AUTO RUN LOOP ---
(async () => {
  while (true) {
    console.log("🕒 Starting new outreach cycle...");
    try {
      await runCycle();
    } catch (err) {
      console.error("💥 Cycle crashed:", err);
    }

    const waitMins = 20 + Math.floor(Math.random() * 10);
    console.log(`💤 Sleeping ${waitMins} min before next cycle...\n`);
    await sleep(waitMins * 60 * 1000);
  }
})();
