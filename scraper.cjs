// scraper.cjs — Lead Finder Edition (v4.0, Buyer Intent Optimized)
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
const csvPath = path.join(baseDir, "lead_finder_clients.csv");
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

// === Subreddits (sorted by lead-gen intent) ===
const subs = [
  "Entrepreneur", "smallbusiness", "freelance", "forhire", "SideProject",
  "marketing", "EntrepreneurRideAlong", "SaaS", "Startups", "growthhacking",
  "marketingautomation", "business", "sales", "agency", "indiehackers"
];

// === Search Terms (refined for lead-gen + client acquisition buyers) ===
const searchTerms = [
  "need leads", "find clients", "hire marketer", "growth help",
  "marketing help", "sales leads", "client acquisition",
  "lead generation", "help with outreach", "cold email", 
  "how to get clients", "find customers", "reddit growth"
];

// === Filters ===
const sellerWords = [
  "for hire", "offer", "offering", "available", "hire me", "portfolio", "we build",
  "i build", "i made", "my tool", "our team", "commission me", "services", "dm me"
];

const buyerWords = [
  "need", "looking for", "hire", "hiring", "find", "get", "acquire", "generate",
  "clients", "leads", "customers", "help with marketing", "growth help",
  "sales help", "paid project", "commission", "create for me", "any marketer"
];

const contextWords = [
  "marketing", "growth", "sales", "freelance", "agency", "business",
  "startup", "automation", "saas", "promotion", "lead"
];

// ---- Buyer Detector ----
function isBuyer(post) {
  const text = (post.title + " " + (post.selftext || "")).toLowerCase();
  if (sellerWords.some((w) => text.includes(w))) return false;

  const wantsWork = buyerWords.some((w) => text.includes(w));
  const mentionsContext = contextWords.some((w) => text.includes(w));

  // Require both — buyer intent and business/marketing context
  if (!wantsWork || !mentionsContext) return false;

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
          const isLeadGen =
            text.includes("find clients") ||
            text.includes("get leads") ||
            text.includes("lead generation") ||
            text.includes("growth help");

          leads.push({
            username: p.author.name,
            title: p.title,
            url: `https://reddit.com${p.permalink}`,
            subreddit: p.subreddit.display_name,
            time: new Date(p.created_utc * 1000).toISOString(),
            leadType: isLeadGen ? "Lead Generation Buyer" : "Marketing Buyer",
          });

          console.log(`🎯 Lead Finder Buyer: ${p.title} (${p.subreddit.display_name})`);
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
    console.log("\n🚀 Running Lead Finder Buyer Scraper v4.0...");
    try {
      const leads = await runScrape();

      if (!leads.length) {
        console.log("❌ No new buyer-type leads found this run.");
      } else {
        console.log(`✅ Added ${leads.length} verified lead-gen buyers to CSV.`);
        console.log("📨 Launching DM sequence (agency_bot.cjs)...");

        const agencyBotPath = path.resolve(__dirname, "agency_bot.cjs");
        exec(`node ${agencyBotPath} lead_finder_clients`, (err, stdout, stderr) => {
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
