// scraper.cjs Lead Finder Edition v5 Buyers plus Sellers
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const snoowrap = require("snoowrap");
const { createObjectCsvWriter } = require("csv-writer");
const { exec } = require("child_process");

// Reddit client
const reddit = new snoowrap({
  userAgent: process.env.REDDIT_USER_AGENT,
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
});

// Absolute CSV paths
const baseDir = path.resolve(__dirname, "logs");
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

const buyerCsvPath = path.join(baseDir, "lead_finder_buyers.csv");
const sellerCsvPath = path.join(baseDir, "lead_finder_sellers.csv");

// CSV writers
const buyerWriter = createObjectCsvWriter({
  path: buyerCsvPath,
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

const sellerWriter = createObjectCsvWriter({
  path: sellerCsvPath,
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

// Subreddits
const subs = [
  "Entrepreneur", "smallbusiness", "freelance", "forhire", "SideProject",
  "marketing", "EntrepreneurRideAlong", "SaaS", "Startups", "growthhacking",
  "marketingautomation", "business", "sales", "agency", "indiehackers",
  "digitalmarketing", "Upwork", "Consulting", "contentmarketing",
  "freelancers", "copywriting", "webdev", "Advertising",
  "shopify", "shopifydev", "woocommerce",
  "web_design", "webdevelopers", "programmingrequests",
  "learnprogramming", "python", "coding",
  "Ecommerce", "Dropship", "AmazonSeller",
  "etsy", "EtsySellers", "YoutubeCreators",
  "SocialMediaMarketing", "FacebookAdsBuySell",
  "PPC", "SEO", "bigseo",
];

// Search terms buyers plus sellers
const searchTerms = [
  // buyer flavor
  "need help",
  "need developer",
  "need automation",
  "help with code",
  "build this",
  "fix my site",
  "fix my code",
  "hire developer",
  "looking for developer",
  "looking for automation",
  "python help",
  "web scraping",
  "bot developer",
  "website fix",
  "coding help",
  "programmer needed",
  "automation request",
  "need leads", "find clients", "hire marketer", "growth help",
  "marketing help", "sales leads", "client acquisition",
  "lead generation", "help with outreach", "cold email",
  "how to get clients", "find customers", "reddit growth",

  // seller flavor
  "for hire",
  "available for work",
  "available for projects",
  "taking clients",
  "new clients",
  "portfolio",
  "our agency",
  "we build",
  "i build",
  "web design services",
  "seo services",
  "marketing services",
  "lead gen agency",
];

// Filters
const sellerWords = [
  "for hire",
  "offer",
  "offering",
  "available",
  "hire me",
  "portfolio",
  "we build",
  "i build",
  "i made",
  "my tool",
  "our team",
  "commission me",
  "services",
  "dm me",
  "taking clients",
  "open for work",
  "open for projects",
];

const buyerWords = [
  "need",
  "looking for",
  "hire",
  "hiring",
  "find",
  "get",
  "acquire",
  "generate",
  "clients",
  "leads",
  "customers",
  "help with marketing",
  "growth help",
  "sales help",
  "paid project",
  "commission",
  "create for me",
  "any marketer",
];

const contextWords = [
  "marketing",
  "growth",
  "sales",
  "freelance",
  "agency",
  "business",
  "startup",
  "automation",
  "saas",
  "promotion",
  "lead",
  "client",
  "clients",
  "store",
  "shop",
  "shopify",
  "ecom",
  "ecommerce",
];

// Buyer detector
function isBuyer(post) {
  const text = (post.title + " " + (post.selftext || "")).toLowerCase();

  // if clearly a seller ad skip for buyer mode
  if (sellerWords.some((w) => text.includes(w))) return false;

  const wantsWork = buyerWords.some((w) => text.includes(w));
  const mentionsContext = contextWords.some((w) => text.includes(w));

  if (!wantsWork || !mentionsContext) return false;
  if (text.length < 40) return false;
  if (/(free|unpaid|exposure)/.test(text)) return false;

  return true;
}

// Seller detector freelancers agencies service providers
function isSeller(post) {
  const text = (post.title + " " + (post.selftext || "")).toLowerCase();

  const offersServices = sellerWords.some((w) => text.includes(w));
  const hasContext = contextWords.some((w) => text.includes(w));

  if (!offersServices || !hasContext) return false;
  if (text.length < 40) return false;

  // filter obvious job search not service ads
  if (text.includes("looking for job") || text.includes("full time role")) return false;

  return true;
}

// Freshness filter 48h max
function isRecent(post) {
  const now = Date.now();
  const postTime = post.created_utc * 1000;
  const hoursOld = (now - postTime) / (1000 * 60 * 60);
  return hoursOld <= 48;
}

// Scrape runner
async function runScrape() {
  const buyerLeads = [];
  const sellerLeads = [];

  for (const sub of subs) {
    for (const term of searchTerms) {
      console.log(`Searching r/${sub} for "${term}"`);
      try {
        let posts = await reddit.getSubreddit(sub).search({
          query: term,
          sort: "new",
          limit: 50,
        });

        if (!posts.length) {
          console.log(`Retrying r/${sub} top of month`);
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

          const buyerFlag = isBuyer(p);
          const sellerFlag = isSeller(p);
          if (!buyerFlag && !sellerFlag) return;

          const text = (p.title + " " + (p.selftext || "")).toLowerCase();
          const isLeadGen =
            text.includes("find clients") ||
            text.includes("get leads") ||
            text.includes("lead generation") ||
            text.includes("growth help");

          const baseLead = {
            username: p.author.name,
            title: p.title,
            url: `https://reddit.com${p.permalink}`,
            subreddit: p.subreddit.display_name,
            time: new Date(p.created_utc * 1000).toISOString(),
          };

          if (buyerFlag) {
            buyerLeads.push({
              ...baseLead,
              leadType: isLeadGen ? "Lead Generation Buyer" : "Buyer Needs Help",
            });
            console.log(
              `Buyer lead ${p.subreddit.display_name} | ${p.title}`
            );
          }

          if (sellerFlag) {
            sellerLeads.push({
              ...baseLead,
              leadType: "Service Provider Seller",
            });
            console.log(
              `Seller lead ${p.subreddit.display_name} | ${p.title}`
            );
          }
        });

        await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        console.log(`Issue in ${sub} with term "${term}" | ${err.message}`);
        continue;
      }
    }
  }

  // dedupe and write buyers
  const uniqueBuyer = Array.from(
    new Map(buyerLeads.map((o) => [o.url, o])).values()
  );
  const uniqueSeller = Array.from(
    new Map(sellerLeads.map((o) => [o.url, o])).values()
  );

  let existingBuyerData = "";
  if (fs.existsSync(buyerCsvPath)) {
    existingBuyerData = fs.readFileSync(buyerCsvPath, "utf8");
  }

  let existingSellerData = "";
  if (fs.existsSync(sellerCsvPath)) {
    existingSellerData = fs.readFileSync(sellerCsvPath, "utf8");
  }

  const newBuyerLeads = uniqueBuyer.filter(
    (lead) => !existingBuyerData.includes(lead.url)
  );
  const newSellerLeads = uniqueSeller.filter(
    (lead) => !existingSellerData.includes(lead.url)
  );

  if (newBuyerLeads.length > 0) {
    await buyerWriter.writeRecords(newBuyerLeads);
  }
  if (newSellerLeads.length > 0) {
    await sellerWriter.writeRecords(newSellerLeads);
  }

  return { buyerLeads: newBuyerLeads, sellerLeads: newSellerLeads };
}

// Loop plus DM chain
async function loopScraper() {
  while (true) {
    console.log("\nRunning Lead Finder Scraper v5 buyers plus sellers");
    try {
      const { buyerLeads, sellerLeads } = await runScrape();
      const total = buyerLeads.length + sellerLeads.length;

      if (!total) {
        console.log("No new leads this run");
      } else {
        console.log(
          `New leads buyers ${buyerLeads.length} sellers ${sellerLeads.length}`
        );
        const agencyBotPath = path.resolve(__dirname, "agency_bot.cjs");

        if (buyerLeads.length) {
          console.log("Launching DM sequence for buyers");
          exec(
            `node ${agencyBotPath} lead_finder_buyers`,
            (err, stdout, stderr) => {
              if (err) console.error("Buyer DM script issue", err);
              if (stdout) console.log(stdout);
              if (stderr) console.error(stderr);
            }
          );
        }

        if (sellerLeads.length) {
          console.log("Launching DM sequence for sellers");
          exec(
            `node ${agencyBotPath} lead_finder_sellers`,
            (err, stdout, stderr) => {
              if (err) console.error("Seller DM script issue", err);
              if (stdout) console.log(stdout);
              if (stderr) console.error(stderr);
            }
          );
        }
      }
    } catch (err) {
      console.error("Scraper crash", err);
    }

    const mins = 45 + Math.floor(Math.random() * 15);
    console.log(`Sleeping ${mins} minutes before next cycle\n`);
    await new Promise((r) => setTimeout(r, mins * 60 * 1000));
  }
}

// Start
loopScraper();
