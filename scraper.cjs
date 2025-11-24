// scraper.cjs — Lead Finder v8 (Synced With DM Bot)
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

// Output CSV (one file)
const baseDir = path.resolve(__dirname, "logs");
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir);

const leadsPath = path.join(baseDir, "lead_finder_buyers.csv");

// Ensure CSV header exists
if (!fs.existsSync(leadsPath)) {
  fs.writeFileSync(
    leadsPath,
    "username,title,url,subreddit,time,leadType\n"
  );
}

// Prepend lead to CSV
function prependLead(file, rowObj) {
  const row = Object.values(rowObj).join(",") + "\n";
  const existing = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, row + existing);
}

// Load existing URLs for dedupe
function loadExistingUrls() {
  if (!fs.existsSync(leadsPath)) return new Set();
  const data = fs.readFileSync(leadsPath, "utf8").split("\n");
  const urls = new Set();
  for (let line of data) {
    const parts = line.split(",");
    const url = parts[2];
    if (url && url.includes("reddit.com")) urls.add(url.trim());
  }
  return urls;
}

// Subreddits
const subs = [
  "Entrepreneur","smallbusiness","business","Startups",
  "marketing","digitalmarketing","growthhacking","SocialMediaMarketing",
  "SEO","bigseo","PPC","Advertising","copywriting",
  "agency","Consulting","freelancers","freelance","forhire",
  "webdev","web_design","webdevelopers","programmingrequests",
  "learnprogramming","coding","python",
  "EntrepreneurRideAlong","SideProject",
  "Ecommerce","Dropship","AmazonSeller",
  "SaaS","software","indiehackers","contentmarketing",
  "shopify","privatepractice","Dentistry","Therapists",
];

// Phrases
const buyerPhrases = [
  "need help","looking for","hire","developer needed","growth help",
  "sales help","lead generation","find clients","get clients",
  "automation help","marketing help","seo help","ppc help",
  "build my website","fix my","recommendations",
];

const sellerPhrases = [
  "for hire","available","offering services","taking clients","portfolio",
  "we build","i build","open for projects","agency","service provider",
];

// Freshness (72h max)
function isRecent(post) {
  const hours = (Date.now() - post.created_utc * 1000) / 36e5;
  return hours <= 72;
}

function classify(post) {
  const text = (post.title + " " + post.selftext).toLowerCase();
  if (buyerPhrases.some((x) => text.includes(x))) return "Buyer";
  if (sellerPhrases.some((x) => text.includes(x))) return "Seller";
  return null;
}

// Delay
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Scraper
async function scrape() {
  console.log("Starting Lead Finder v8 scrape…");

  const existingUrls = loadExistingUrls();

  let buyers = 0;
  let sellers = 0;

  for (const sub of subs) {
    console.log(`\nSearching r/${sub}`);

    try {
      const posts = await reddit.getSubreddit(sub).getNew({ limit: 80 });

      for (const p of posts) {
        if (!p.author || !isRecent(p)) continue;

        const type = classify(p);
        if (!type) continue;

        const url = `https://reddit.com${p.permalink}`;
        if (existingUrls.has(url)) continue;

        const row = {
          username: p.author.name,
          title: `"${p.title.replace(/"/g, "'")}"`,
          url,
          subreddit: sub,
          time: new Date(p.created_utc * 1000).toISOString(),
          leadType: type,
        };

        prependLead(leadsPath, row);
        existingUrls.add(url);

        if (type === "Buyer") buyers++;
        else sellers++;
      }

      await wait(2500);
    } catch (err) {
      console.log(`Error in r/${sub}: ${err.message}`);
      console.log("Cooldown 45 sec…");
      await wait(45000);
    }
  }

  console.log(
    `\nScrape done — New Buyers: ${buyers}, Sellers: ${sellers}\nSleeping 2 hours…\n`
  );
}

// Loop
(async () => {
  while (true) {
    await scrape();
    await wait(2 * 60 * 60 * 1000);
  }
})();
