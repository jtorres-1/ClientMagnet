// scraper.cjs — Buyer Detection + Auto-Run + Dependent DM Chain (v3.4, Optimized Targeting)
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const snoowrap = require("snoowrap");
const { createObjectCsvWriter } = require("csv-writer");
const { exec } = require("child_process");

// ---- Reddit Client ----
const reddit = new snoowrap({
  userAgent: process.env.REDDIT_USER_AGENT,
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
});

// ---- Absolute CSV Path ----
const baseDir = path.resolve(__dirname, "logs");
const csvPath = path.join(baseDir, "automation_clients.csv");

if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

// ---- CSV Writer ----
const writer = createObjectCsvWriter({
  path: csvPath,
  header: [
    { id: "username", title: "Username" },
    { id: "title", title: "Post Title" },
    { id: "url", title: "Post URL" },
    { id: "subreddit", title: "Subreddit" },
    { id: "time", title: "Timestamp" },
    { id: "leadType", title: "Lead Type" },
  ],
  append: true,
});

// === Subreddits (sorted by buyer intent) ===
const subs = [
  // 🧠 Highest buyer intent
  "forhire", "slavelabour", "jobbit", "HireaDeveloper", "ProgrammingRequests",

  // 💼 Secondary: project-based and business
  "RemoteJobs", "WorkOnline", "freelance", "Entrepreneur", "SideProject", "Startups", "SaaS", "smallbusiness",

  // ⚙️ Tech/Automation specific
  "automation", "nocode", "AIinEntrepreneurship", "webdev", "remotedev"
];

// === Search Terms (refined for dev/automation buyers) ===
const searchTerms = [
  "looking for developer",
  "hire developer",
  "need developer",
  "need automation",
  "build me a bot",
  "custom bot",
  "reddit bot",
  "dm automation",
  "web scraper",
  "automation help",
  "build script",
  "python automation",
  "looking to automate",
  "automation project",
  "telegram bot",
  "ai automation"
];

// === Filters ===
const sellerWords = [
  "for hire", "offer", "offering", "available", "hire me", "portfolio", "we build",
  "i build", "i made", "my tool", "our team", "commission me", "services", "dm me"
];

const buyerWords = [
  "need", "looking for", "hire", "hiring", "developer needed",
  "can someone", "paid project", "budget", "commission", "create for me",
  "build for me", "searching for", "any dev", "any coder", "build bot"
];

const techWords = [
  "automation", "bot", "script", "scraper", "python", "node", "api",
  "discord", "telegram", "reddit", "web", "selenium", "data extraction"
];

// ---- Buyer Detector ----
function isBuyer(post) {
  const text = (post.title + " " + (post.selftext || "")).toLowerCase();
  if (sellerWords.some((w) => text.includes(w))) return false;

  const wantsWork = buyerWords.some((w) => text.includes(w));
  const mentionsTech = techWords.some((w) => text.includes(w));

  // Require both — clear buyer intent AND tech mention
  if (!wantsWork || !mentionsTech) return false;

  // Filter out spam/low-quality
  if (text.length < 40) return false;
  if (/(free|unpaid|exposure)/.test(text)) return false;

  return true;
}

// ---- Freshness Filter (48h max) ----
function isRecent(post) {
  const now = Date.now();
  const postTime = post.created_utc * 1000;
  const hoursOld = (now - postTime) / (1000 * 60 * 60);
  return hoursOld <= 48;
}

// ---- Scrape Runner ----
async function runScrape() {
  const leads = [];

  for (const sub of subs) {
    for (const term of searchTerms) {
      console.log(`🔎 Searching r/${sub} for "${term}"...`);
      try {
        let posts = await reddit.getSubreddit(sub).search({
          query: term,
          sort: "new",
          limit: 50,
        });

        // Fallback for low-activity subs
        if (!posts.length) {
          console.log(`↩️ Retrying r/${sub} (top of month)...`);
          posts = await reddit.getSubreddit(sub).search({
            query: term,
            sort: "top",
            time: "month",
            limit: 50,
          });
        }

        posts.forEach((p) => {
          if (!p.author) return;
          if (!isRecent(p)) return;
          if (!isBuyer(p)) return;

          const text = (p.title + " " + (p.selftext || "")).toLowerCase();
          const isRedditBotLead =
            text.includes("reddit bot") ||
            text.includes("dm bot") ||
            text.includes("telegram bot");

          leads.push({
            username: p.author.name,
            title: p.title,
            url: `https://reddit.com${p.permalink}`,
            subreddit: p.subreddit.display_name,
            time: new Date(p.created_utc * 1000).toISOString(),
            leadType: isRedditBotLead ? "Reddit Bot Buyer" : "Automation Buyer",
          });

          console.log(`🎯 Buyer Lead: ${p.title} (${p.subreddit.display_name})`);
        });

        await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        console.log(`⚠️ ${sub} | ${term} | ${err.message}`);
        continue;
      }
    }
  }

  // ---- Deduplicate and Write ----
  const unique = Array.from(new Map(leads.map((o) => [o.url, o])).values());
  if (!unique.length) return [];

  let existingData = "";
  if (fs.existsSync(csvPath)) existingData = fs.readFileSync(csvPath, "utf8");
  const newLeads = unique.filter((lead) => !existingData.includes(lead.url));

  if (newLeads.length > 0) await writer.writeRecords(newLeads);
  return newLeads;
}

// ---- Loop + Dependent DM Chain ----
async function loopScraper() {
  while (true) {
    console.log("\n🚀 Running Optimized Reddit Buyer-Focused Lead Scraper v3.4...");
    try {
      const leads = await runScrape();

      if (!leads.length) {
        console.log("❌ No new buyer-type leads found this run.");
      } else {
        console.log(`✅ Added ${leads.length} verified automation leads to CSV.`);
        console.log("📨 Launching DM sequence (agency_bot.cjs)...");

        const agencyBotPath = path.resolve(__dirname, "agency_bot.cjs");
        exec(`node ${agencyBotPath} automation_clients`, (err, stdout, stderr) => {
          if (err) console.error("⚠️ Failed to run agency_bot:", err);
          if (stdout) console.log(stdout);
          if (stderr) console.error(stderr);
        });
      }
    } catch (err) {
      console.error("💥 Scraper crashed:", err);
    }

    // Wait 45–60 min before next run
    const mins = 45 + Math.floor(Math.random() * 15);
    console.log(`💤 Sleeping ${mins} minutes before next scrape cycle...\n`);
    await new Promise((r) => setTimeout(r, mins * 60 * 1000));
  }
}

// ---- Start ----
loopScraper();
