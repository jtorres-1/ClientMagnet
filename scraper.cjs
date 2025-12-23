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
   HIGH INTENT SUBREDDITS ONLY
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
   BUYER LANGUAGE (EXPLICIT + IMPLIED)
============================================ */
const hireRegex = /(hiring|looking for|need help|need someone|need a|can someone|help building|looking to build|developer needed|freelancer needed|automation needed|bot needed|scraper needed|mvp help|api help)/i;

/* ============================================
   TECHNICAL SCOPE SIGNALS
============================================ */
const devRegex = /(python|javascript|typescript|node|react|next\.js|express|flask|django|fastapi|api|backend|frontend|full stack|database|sql|postgres|mysql|automation|scraper|web app|saas|bot)/i;

/* ============================================
   HARD EXCLUSIONS (NON BUYERS)
============================================ */
const nonDevRegex = /(video|youtube|tiktok|roblox|minecraft|vtuber|graphic|design|logo|editing|resume|pdf|content|writer|writing|social media|marketing|commission|salary|discussion)/i;

/* ============================================
   SELLER PHRASES (ONLY BLOCK IF NO BUYER INTENT)
============================================ */
const sellerRegex = /(i am a developer|i am a freelancer|hire me|offering services|my services|available for work|\[offer\])/i;

// Fresh window: 48 HOURS
function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 48;
}

// FINAL classification
function classify(post) {
  const title = (post.title || "").toLowerCase();
  const body = (post.selftext || "").toLowerCase();

  if (title.length < 10) return null;
  if (nonDevRegex.test(title + body)) return null;

  const hasHireIntent = hireRegex.test(title) || hireRegex.test(body);
  if (!hasHireIntent) return null;

  if (sellerRegex.test(title + body) && !hireRegex.test(title)) return null;

  const hasDevSignal = devRegex.test(title) || devRegex.test(body);
  if (!hasDevSignal) return null;

  const hireMatch = title.match(hireRegex) || body.match(hireRegex);
  const devMatch = title.match(devRegex) || body.match(devRegex);

  return `${hireMatch[0]} + ${devMatch[0]}`;
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
      await wait(900);
      const posts = await reddit.getSubreddit(sub).getNew({ limit: 40 });

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
      await wait(20000);
    }
  }

  console.log(`Scrape complete — DEV gigs found: ${leads}`);
}

// Run hourly
(async () => {
  while (true) {
    await scrape();
    await wait(60 * 60 * 1000);
  }
})();
