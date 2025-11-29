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

// Output CSV
const baseDir = path.resolve(__dirname, "logs");
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir);

const leadsPath = path.join(baseDir, "lead_finder_buyers.csv");
const dmedFiles = [
  "lead_finder_buyers_dmed.csv",
  "all_dmed.csv"
];

// Ensure CSV header exists
if (!fs.existsSync(leadsPath)) {
  fs.writeFileSync(
    leadsPath,
    "username,title,url,subreddit,time,leadType\n"
  );
}

// Prepend row
function prependLead(file, rowObj) {
  const row = Object.values(rowObj).join(",") + "\n";
  const existing = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, row + existing);
}

// Load previously messaged usernames
function loadDMedUsers() {
  const set = new Set();
  for (const file of dmedFiles) {
    const full = path.join(baseDir, file);
    if (!fs.existsSync(full)) continue;

    const lines = fs.readFileSync(full, "utf8").split("\n");
    for (let line of lines) {
      const user = line.split(",")[0];
      if (user) set.add(user.trim().toLowerCase());
    }
  }
  return set;
}

// Subreddits (buyer-rich subs)
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

// Phrases (buyer only)
const buyerPhrases = [
  "need help",
  "looking for",
  "hire",
  "developer needed",
  "growth help",
  "sales help",
  "lead generation",
  "find clients",
  "get clients",
  "automation help",
  "marketing help",
  "seo help",
  "ppc help",
  "build my website",
  "fix my",
  "recommendations",
  "consultant",
  "freelancer needed",
  "help me with",
  "anyone available",
  "who can do",
];

// Strict 4 day filter
function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 96; // 4 days only
}

function classify(post) {
  const text = (post.title + " " + (post.selftext || "")).toLowerCase();

  if (buyerPhrases.some((x) => text.includes(x))) return "Buyer";

  return null;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Scraper
async function scrape() {
  console.log("Starting Lead Finder — buyer-only mode…");

  const dmedUsers = loadDMedUsers();
  const existingUrls = new Set(
    fs.readFileSync(leadsPath, "utf8")
      .split("\n")
      .map((l) => l.split(",")[2])
  );

  let buyers = 0;

  for (const sub of subs) {
    console.log(`\nSearching r/${sub}`);

    try {
      // critical delay BEFORE reddit API call
      await wait(3000);

      let posts = await reddit.getSubreddit(sub).getNew({ limit: 50 });

      // FILTER STRICT 4 days + skip already messaged users
      posts = posts.filter(p =>
        p.author &&
        isFresh(p) &&
        !dmedUsers.has(p.author.name.toLowerCase())
      );

      for (const p of posts) {
        const type = classify(p);
        if (type !== "Buyer") continue;

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

        buyers++;
      }

      await wait(2000);

    } catch (err) {
      console.log(`Error in r/${sub}: ${err.message}`);
      await wait(45000);
    }
  }

  console.log(
    `\nScrape done — Fresh Buyers: ${buyers}\nSleeping 2 hours…\n`
  );
}

(async () => {
  while (true) {
    await scrape();
    await wait(2 * 60 * 60 * 1000);
  }
})();
