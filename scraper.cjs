require("dotenv").config();
const fs = require("fs");
const path = require("path");
const snoowrap = require("snoowrap");

// Reddit client
const reddit = new snoowrap({
  userAgent: process.env.REDDIT_USER_AGENT,
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
});

// Paths
const baseDir = path.resolve(__dirname, "logs");
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir);
const leadsPath = path.join(baseDir, "clean_leads.csv");

// CSV Header
const HEADER = "username,title,url,subreddit,time,leadType,matchedTrigger";

// Init CSV
if (!fs.existsSync(leadsPath)) {
  fs.writeFileSync(leadsPath, HEADER + "\n");
}

// Insert row under header
function prependLead(file, rowObj) {
  const row = Object.values(rowObj).join(",") + "\n";
  const lines = fs.readFileSync(file, "utf8").split("\n");
  if (!lines[0].startsWith("username")) lines.unshift(HEADER);
  lines.splice(1, 0, row.trim());
  fs.writeFileSync(file, lines.join("\n"));
}

/* ============================================
   SUBREDDITS THAT ACTUALLY CONVERT
============================================ */
const subs = [
  "forhire",
  "jobbit",
  "slavelabour",
  "webdev",
  "remotejs",
  "remotedev"
];

/* ============================================
   BUYER INTENT ONLY
============================================ */
const hireTriggers = [
  "[hiring]",
  "hiring",
  "looking for",
  "need help",
  "need someone",
  "need a",
  "build",
  "can someone",
  "developer needed",
  "freelancer needed"
];

/* ============================================
   REAL CODING SIGNALS ONLY
============================================ */
const devSignals = [
  "python",
  "javascript",
  "typescript",
  "node",
  "react",
  "next.js",
  "express",
  "flask",
  "django",
  "fastapi",
  "api",
  "backend",
  "frontend",
  "full stack",
  "database",
  "sql",
  "postgres",
  "mysql",
  "automation",
  "scraper",
  "web app",
  "saas"
];

/* ============================================
   HARD EXCLUSIONS (NON-DEV WORK)
============================================ */
const nonDevExclusions = [
  "video",
  "videos",
  "youtube",
  "tiktok",
  "roblox",
  "minecraft",
  "vtuber",
  "graphics",
  "graphic",
  "design",
  "designer",
  "logo",
  "editing",
  "editor",
  "resume",
  "pdf",
  "content",
  "writer",
  "writing",
  "social media",
  "marketing",
  "lead setter",
  "commission",
  "salary",
  "discussion"
];

/* ============================================
   EXCLUDE SELLERS
============================================ */
const sellerPhrases = [
  "i am a developer",
  "i am a freelancer",
  "for hire",
  "hire me",
  "offering services",
  "my services",
  "available for work",
  "[offer]"
];

// Fresh window: 3 DAYS (volume without junk)
function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 168;
}

// FINAL classification logic
function classify(post) {
  const text =
    ((post.title || "") + " " + (post.selftext || "")).toLowerCase();

  if (text.length < 40) return null;
  if (sellerPhrases.some(p => text.includes(p))) return null;
  if (nonDevExclusions.some(x => text.includes(x))) return null;

  const hireMatch = hireTriggers.find(t => text.includes(t));
  if (!hireMatch) return null;

  const devMatch = devSignals.find(d => text.includes(d));
  if (!devMatch) return null;

  return `${hireMatch} + ${devMatch}`;
}

const wait = ms => new Promise(res => setTimeout(res, ms));

/* ============================================
   SCRAPER LOOP
============================================ */
async function scrape() {
  console.log("Starting DEV-ONLY GIG SCRAPER…");

  const existingUrls = new Set(
    fs.readFileSync(leadsPath, "utf8")
      .split("\n")
      .map(l => l.split(",")[2])
  );

  let leads = 0;

  for (const sub of subs) {
    console.log(`Scanning r/${sub}`);

    try {
      await wait(3000);
      const posts = await reddit.getSubreddit(sub).getNew({ limit: 75 });

      for (const p of posts) {
        if (!p.author || !isFresh(p)) continue;

        const match = classify(p);
        if (!match) continue;

        const url = `https://reddit.com${p.permalink}`;
        if (existingUrls.has(url)) continue;

        const row = {
          username: p.author.name,
          title: `"${p.title.replace(/"/g, "'")}"`,
          url,
          subreddit: sub,
          time: new Date(p.created_utc * 1000).toISOString(),
          leadType: "DEV-GIG",
          matchedTrigger: match
        };

        prependLead(leadsPath, row);
        existingUrls.add(url);
        leads++;
      }

    } catch (err) {
      console.log(`Error r/${sub}: ${err.message}`);
      await wait(45000);
    }
  }

  console.log(`Scrape complete — REAL DEV gigs found: ${leads}`);
}

// Run hourly
(async () => {
  while (true) {
    await scrape();
    await wait(60 * 60 * 1000);
  }
})();
