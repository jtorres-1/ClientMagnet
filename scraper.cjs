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

// Output directory
const baseDir = path.resolve(__dirname, "logs");
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir);

// Output CSV
const leadsPath = path.join(baseDir, "clean_leads.csv");

// CSV Header
const HEADER = "username,title,url,subreddit,time,leadType,matchedTrigger";

// Init CSV once
if (!fs.existsSync(leadsPath)) {
  fs.writeFileSync(leadsPath, HEADER + "\n");
}

// Insert lead under header
function prependLead(file, rowObj) {
  const row = Object.values(rowObj).join(",") + "\n";
  let lines = fs.readFileSync(file, "utf8").split("\n");
  if (!lines[0].startsWith("username")) lines.unshift(HEADER);
  lines.splice(1, 0, row.trim());
  fs.writeFileSync(file, lines.join("\n"));
}

/* ============================================
   HIGH INTENT SUBREDDITS ONLY
============================================ */
const subs = [
  "forhire",
  "jobbit",
  "slavelabour"
];

/* ============================================
   REAL BUYER PHRASES
============================================ */
const hireTriggers = [
  "looking for a developer",
  "need a developer",
  "need dev",
  "hiring a developer",
  "hire a developer",
  "developer wanted",
  "freelancer wanted",
  "looking for freelancer",
  "need a freelancer",
  "need someone to build",
  "can someone build",
  "build me",
  "need automation",
  "need a script",
  "need bot",
  "need scraper"
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
  "available for work"
];

// Fresh posts only
function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 10;
}

// Classify ONLY real dev gigs
function classify(post) {
  const text = (post.title + " " + (post.selftext || "")).toLowerCase();

  if (text.length < 40) return null;
  if (sellerPhrases.some(p => text.includes(p))) return null;

  const matchedTrigger = hireTriggers.find(t => text.includes(t));
  if (!matchedTrigger) return null;

  return matchedTrigger;
}

const wait = ms => new Promise(res => setTimeout(res, ms));

/* ============================================
   SCRAPER LOOP
============================================ */
async function scrape() {
  console.log("Starting DEV GIG SCRAPER…");

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
      const posts = await reddit.getSubreddit(sub).getNew({ limit: 50 });

      for (const p of posts) {
        if (!p.author || !isFresh(p)) continue;

        const matchedTrigger = classify(p);
        if (!matchedTrigger) continue;

        const url = `https://reddit.com${p.permalink}`;
        if (existingUrls.has(url)) continue;

        const row = {
          username: p.author.name,
          title: `"${p.title.replace(/"/g, "'")}"`,
          url,
          subreddit: sub,
          time: new Date(p.created_utc * 1000).toISOString(),
          leadType: "DEV-GIG",
          matchedTrigger
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

  console.log(`Scrape complete — REAL dev gigs found: ${leads}`);
}

// Loop hourly
(async () => {
  while (true) {
    await scrape();
    await wait(60 * 60 * 1000);
  }
})();
