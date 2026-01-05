require("dotenv").config();
const fs = require("fs");
const path = require("path");
const snoowrap = require("snoowrap");

/* =========================
   REDDIT CLIENT
========================= */
const reddit = new snoowrap({
  userAgent: process.env.REDDIT_USER_AGENT,
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
});

/* =========================
   PATHS
========================= */
const baseDir = path.resolve(__dirname, "logs");
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir);
const leadsPath = path.join(baseDir, "clean_leads.csv");

const HEADER = "username,title,url,subreddit,time,leadType,matchedTrigger";
if (!fs.existsSync(leadsPath)) {
  fs.writeFileSync(leadsPath, HEADER + "\n");
}

function prependLead(file, rowObj) {
  const row = Object.values(rowObj).join(",") + "\n";
  const lines = fs.readFileSync(file, "utf8").split("\n");
  if (!lines[0].startsWith("username")) lines.unshift(HEADER);
  lines.splice(1, 0, row.trim());
  fs.writeFileSync(file, lines.join("\n"));
}

/* =========================
   HIGH-BUYER SUBREDDITS ONLY
========================= */
const subs = [
  "forhire",            // buyers still post here
  "jobbit",             // legit paid gigs
  "Entrepreneur",
  "SaaS",
  "SideProject",
  "startups",
  "smallbusiness",
  "EntrepreneurRideAlong",
  "automation",
  "nocode"
];

/* =========================
   BUYER INTENT (TITLE ONLY)
========================= */
const buyerTitleRegex = /(hiring|looking for|need someone|need a developer|need help|can someone build|who can build|seeking developer|developer needed)/i;

/* =========================
   MONEY LANGUAGE (REQUIRED)
========================= */
const moneyRegex = /(paid|budget|rate|paying|compensation|usd|\$)/i;

/* =========================
   DEV SIGNALS
========================= */
const devRegex = /(python|javascript|node|react|next\.js|flask|django|fastapi|api|automation|scraper|bot|script|backend|frontend|database|sql|csv|excel)/i;

/* =========================
   HARD SELLER BLOCK (ALWAYS KILL)
========================= */
const sellerRegex = /(i am a developer|i am a freelancer|hire me|available for work|\[offer\]|portfolio|my services)/i;

/* =========================
   HARD NON-BUYERS
========================= */
const hardExcludeRegex = /(vtuber|minecraft|roblox|youtube|logo design|graphic design|social media growth|instagram growth)/i;

/* =========================
   FRESH POSTS ONLY
========================= */
function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 72;
}

/* =========================
   INTENT SCORING
========================= */
function scorePost(title, body) {
  let score = 0;
  if (buyerTitleRegex.test(title)) score += 3;
  if (moneyRegex.test(title + " " + body)) score += 2;
  if (devRegex.test(body)) score += 1;
  return score;
}

/* =========================
   CLASSIFIER
========================= */
function classify(post) {
  const title = (post.title || "").toLowerCase();
  const body = (post.selftext || "").toLowerCase();
  const combined = title + " " + body;

  if (title.length < 10) return null;
  if (hardExcludeRegex.test(combined)) return null;
  if (sellerRegex.test(combined)) return null;
  if (!buyerTitleRegex.test(title)) return null;

  const intentScore = scorePost(title, body);
  if (intentScore < 5) return null;

  const buyerMatch = title.match(buyerTitleRegex)?.[0];
  const moneyMatch = combined.match(moneyRegex)?.[0];
  const devMatch = combined.match(devRegex)?.[0];

  return `${buyerMatch} + ${moneyMatch} + ${devMatch}`;
}

const wait = ms => new Promise(res => setTimeout(res, ms));

/* =========================
   SCRAPER LOOP
========================= */
async function scrape() {
  console.log("Starting BUYER-ONLY DEV scraper…");

  const existingUrls = new Set(
    fs.readFileSync(leadsPath, "utf8")
      .split("\n")
      .map(l => l.split(",")[2])
  );

  let leads = 0;

  for (const sub of subs) {
    console.log(`Scanning r/${sub}`);
    try {
      await wait(1200);
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
      await wait(30000);
    }
  }

  console.log(`Scrape complete — BUYER gigs found: ${leads}`);
}

/* =========================
   RUN LOOP
========================= */
(async () => {
  while (true) {
    await scrape();
    await wait(45 * 60 * 1000);
  }
})();
