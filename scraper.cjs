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
   HIGH INTENT SUBREDDITS
============================================ */
const subs = [
  "forhire",
  "jobbit",
  "slavelabour",
  "webdev",
  "remotejs",
  "remotedev",
  "freelance",
  "WorkOnline"
];

/* ============================================
   BUYER LANGUAGE (EXPANDED)
============================================ */
const hireRegex = /(hiring|looking for|looking to|need help|need someone|need a|need an|anyone who can|can someone|is there a|developer needed|freelancer needed|automation|script needed|scraper|bot|mvp|backend help|frontend help|api help|build this|build me|help automate)/i;

/* ============================================
   DEV / TECH SIGNALS
============================================ */
const devRegex = /(python|javascript|typescript|node|react|next\.js|express|flask|django|fastapi|api|backend|frontend|full stack|database|sql|postgres|mysql|automation|scraper|web app|bot|chrome extension|pdf|csv|excel)/i;

/* ============================================
   HARD NON-BUYERS ONLY
============================================ */
const hardExcludeRegex = /(vtuber|minecraft|roblox|youtube channel|editing videos|logo design only|graphic design only|social media growth|instagram growth)/i;

/* ============================================
   SELLER SELF-PROMO (BLOCK ONLY IF NO BUYER SIGNAL)
============================================ */
const sellerRegex = /(i am a developer|i am a freelancer|hire me|available for work|\[offer\])/i;

// Fresh window: 72 HOURS (buyers still respond)
function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 72;
}

// FINAL classification
function classify(post) {
  const title = (post.title || "").toLowerCase();
  const body = (post.selftext || "").toLowerCase();
  const combined = title + " " + body;

  if (title.length < 8) return null;
  if (hardExcludeRegex.test(combined)) return null;

  const hasHireIntent = hireRegex.test(combined);
  if (!hasHireIntent) return null;

  const hasDevSignal = devRegex.test(combined);
  if (!hasDevSignal) return null;

  if (sellerRegex.test(combined) && !hireRegex.test(title)) return null;

  const hireMatch = combined.match(hireRegex);
  const devMatch = combined.match(devRegex);

  return `${hireMatch?.[0]} + ${devMatch?.[0]}`;
}

const wait = ms => new Promise(res => setTimeout(res, ms));

/* ============================================
   SCRAPER LOOP
============================================ */
async function scrape() {
  console.log("Starting DEV-GIG scraper…");

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

  console.log(`Scrape complete — DEV gigs found: ${leads}`);
}

// Run every 45 minutes
(async () => {
  while (true) {
    await scrape();
    await wait(45 * 60 * 1000);
  }
})();
