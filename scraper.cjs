// scraper.cjs — Lead Finder v7 Ultra Reliable Scraper
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

const baseDir = path.resolve(__dirname, "logs");
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir);

const buyersPath = path.join(baseDir, "lead_finder_buyers.csv");
const sellersPath = path.join(baseDir, "lead_finder_sellers.csv");

// Append CSV initialization
function ensureCsv(path, headers) {
  if (!fs.existsSync(path)) {
    const headerRow = headers.join(",") + "\n";
    fs.writeFileSync(path, headerRow);
  }
}

ensureCsv(buyersPath, ["username", "title", "url", "subreddit", "time", "leadType"]);
ensureCsv(sellersPath, ["username", "title", "url", "subreddit", "time", "leadType"]);

// Write rows
function appendCsv(path, row) {
  fs.appendFileSync(path, Object.values(row).join(",") + "\n");
}

// Expanded business-relevant subreddits
const subs = [
  "Entrepreneur", "smallbusiness", "business", "Startups",
  "marketing", "digitalmarketing", "growthhacking", "SocialMediaMarketing",
  "SEO", "bigseo", "PPC", "Advertising", "copywriting",
  "agency", "Consulting", "freelancers", "freelance", "forhire",
  "webdev", "web_design", "webdevelopers", "programmingrequests",
  "learnprogramming", "coding", "python",
  "shopify", "EntrepreneurRideAlong", "SideProject",
  "Ecommerce", "Dropship", "AmazonSeller",
  "legaladvice", "lawfirm", "medspa", "Chiropractic",
  "Dentistry", "Therapists", "privatepractice",
  "SaaS", "software", "indiehackers", "contentmarketing",
];

// Ultra-broad buyer wording
const buyerPhrases = [
  "need help", "need advice",
  "looking for", "hire", "hiring",
  "anyone know", "recommendations",
  "fix my", "build this", "developer needed",
  "need marketer", "automation help",
  "client acquisition", "lead generation",
  "get clients", "find clients",
  "growth help", "sales help",
  "help with marketing", "build my website",
  "seo help", "ppc help",
  "email marketing help", "crm help",
  "business help", "social media help",
];

// Seller wording
const sellerPhrases = [
  "for hire", "available", "taking clients",
  "offering services", "portfolio", "dm me",
  "we build", "i build", "agency", "book a call",
  "open for projects", "service provider",
];

// timing
function wait(ms) {
  return new Promise(res => setTimeout(res, ms));
}

// Freshness 72 hours (increased from 48)
function isRecent(post) {
  const hours = (Date.now() - post.created_utc * 1000) / 36e5;
  return hours <= 72;
}

// Lead classification
function classify(post) {
  const text = (post.title + " " + post.selftext).toLowerCase();

  if (buyerPhrases.some(w => text.includes(w))) return "buyer";
  if (sellerPhrases.some(w => text.includes(w))) return "seller";

  return null;
}

// Main scraping logic
async function scrape() {
  let buyerCount = 0;
  let sellerCount = 0;

  console.log("Starting v7 scrape...");

  for (const sub of subs) {
    console.log(`\nSearching r/${sub}`);

    try {
      const posts = await reddit.getSubreddit(sub).getNew({ limit: 80 });

      for (const p of posts) {
        if (!p.author || !isRecent(p)) continue;

        const type = classify(p);
        if (!type) continue;

        const row = {
          username: p.author.name,
          title: `"${p.title.replace(/"/g, "'")}"`,
          url: `https://reddit.com${p.permalink}`,
          subreddit: sub,
          time: new Date(p.created_utc * 1000).toISOString(),
          leadType: type === "buyer" ? "Buyer" : "Seller",
        };

        if (type === "buyer") {
          appendCsv(buyersPath, row);
          buyerCount++;
        } else {
          appendCsv(sellersPath, row);
          sellerCount++;
        }
      }

      await wait(2500); // slow down to prevent 503 errors
    } catch (err) {
      console.log(`Error in r/${sub}: ${err.message}`);
      console.log("Cooling down for 45 seconds...");
      await wait(45000);
    }
  }

  console.log(`\nScrape finished — New Buyers: ${buyerCount}, Sellers: ${sellerCount}`);
  console.log("Sleeping 2 hours before next cycle...\n");
}

// Loop forever
(async () => {
  while (true) {
    await scrape();
    await wait(2 * 60 * 60 * 1000); // 2 hours
  }
})();
