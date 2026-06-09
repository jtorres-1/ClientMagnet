require("dotenv").config();
const snoowrap = require("snoowrap");
const fs = require("fs");
const path = require("path");

const reddit = new snoowrap({
  userAgent: process.env.REDDIT_USER_AGENT,
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
});

const BANNED_PATH = path.join(__dirname, "logs", "banned_subs.json");
const POSTED_PATH = path.join(__dirname, "logs", "posted_subs.json");

const MIN_DELAY_MS = 10 * 60 * 1000;
const MAX_DELAY_MS = 13 * 60 * 1000;

// Verified for-hire and freelance subs that explicitly allow [FOR HIRE] posts and links
const DEVHIRE_SUBS = [
  // Core hiring subs -- explicitly allow for hire posts
  "forhire",
  "freelance_forhire",
  "slavelabour",
  "jobbit",
  "WorkOnline",
  "Jobs4Bitcoins",
  "HireaWriter",
  "hireadev",
  "freelanceuk",
  "FreelanceWriters",
  "FreelanceDesigners",
  // Dev specific hiring subs
  "PythonJobs",
  "webdevjobs",
  "MachineLearningJobs",
  "remotepython",
  "techjobs",
  "jobboard",
  "WorkOnlineJobs",
  // Remote work and freelance communities
  "RemoteWork",
  "digitalnomad",
  "freelancing",
  "freelance",
  "WorkFromHome",
  "RemoteJobr",
  // Side hustle and gig communities
  "beermoney",
  "sidehustle",
  "gig",
  // Dev communities with weekly hire threads
  "learnpython",
  "webdev",
  "softwareengineering",
];

// Business owner, sales, and marketing subs that allow tool sharing and links
const MAPZAP_SUBS = [
  // Small business and entrepreneur -- core audience
  "smallbusiness",
  "Entrepreneur",
  "EntrepreneurRideAlong",
  "sweatystartup",
  "growmybusiness",
  "startups",
  "Business_Ideas",
  "business",
  "microsaas",
  // Sales and lead gen -- perfect MapZap audience
  "sales",
  "leadgeneration",
  "b2bsales",
  "salesforce",
  "salestechniques",
  "cold_email",
  "coldemail",
  "Emailmarketing",
  "copywriting",
  "content_marketing",
  // Marketing
  "digital_marketing",
  "marketing",
  "b2bmarketing",
  "SEO",
  "PPC",
  "FacebookAds",
  "googleads",
  "socialmediamarketing",
  // Agency and consulting
  "agency",
  "msp",
  "consulting",
  "recruiting",
  // Real estate and insurance -- heavy cold outreach users
  "realestateinvesting",
  "realestate",
  "InsuranceAgents",
  "realtors",
  "Mortgages",
  // Ecommerce and online business
  "shopify",
  "ecommerce",
  "dropship",
  "AmazonSeller",
  "FulfillmentByAmazon",
  "Flipping",
  "reselling",
  // Hustle and side income
  "hustle",
  "Affiliatemarketing",
  "passive_income",
  "automation",
  // Niche business communities
  "legaladvice",
  "Dentistry",
  "MedicalBilling",
  "acupuncture",
  "personaltraining",
  "HomeImprovement",
  "Plumbing",
  "HVAC",
  "Roofing",
  "Landscaping",
];

const DEVHIRE_POSTS = [
  {
    title: "[FOR HIRE] Python developer — websites, scrapers, bots, AI integrations — flat fee, 48hr delivery",
    text: `Available for freelance work this week.

I build websites, web scrapers, automation bots, and AI integrations. All flat fee, no hourly. 48 hour delivery on most projects.

Things I have shipped: a live SaaS with Stripe payments and Google Maps integration, a cold email pipeline running 500 emails per day, and a Reddit automation bot in production.

Floor: $500 for websites, $800 for automation and scrapers.

DM me what you need built.`
  },
  {
    title: "[FOR HIRE] Python dev in LA — scraping, automation, web apps, AI — ships fast, flat fee",
    text: `Putting this out there — I am a Python developer based in LA available immediately.

I have live production projects running including a Google Maps scraper SaaS, a cold email pipeline, and a Reddit DM automation bot.

I do websites, scrapers, automation, AI integrations. Flat fee only. 48 hour turnaround.

$500 websites, $800 automation, higher for complex builds.

DM me a scope.`
  },
  {
    title: "[FOR HIRE] Freelance Python developer — bots, scrapers, web apps, automation — available now",
    text: `Available for a project this week.

Stack: Python, Flask, Node.js, Puppeteer, OpenAI API, Stripe, PostgreSQL.

Shipped: a live Google Maps lead scraper SaaS, a 500 email per day cold outreach pipeline, a Reddit automation bot, and multiple business websites.

Flat fee. 48 hours. $500 floor for websites, $800 for automation.

DM me what you need.`
  },
  {
    title: "[FOR HIRE] Full stack developer — Python, Node.js, React — automation, AI, web apps — LA based",
    text: `Developer in LA available for freelance work this week.

I build and ship fast. Recent production projects: a Google Maps SaaS scraper with Stripe billing, a cold outreach email pipeline pushing 500 emails per day, and automation bots.

What I do: websites, scrapers, automation pipelines, AI integrations, bots.

Flat fee. 48hr delivery. $500 websites, $800 automation.

DM me a scope and I will tell you if I can build it.`
  },
];

const MAPZAP_POSTS = [
  {
    title: "I got tired of building lead lists manually so I built a tool that does it in 60 seconds",
    text: `Been doing cold outreach for a while and kept wasting hours manually finding local business leads. Finally built something to fix it.

MapZap pulls 100 local businesses from Google Maps in about 60 seconds. Type a business type and city, get a CSV with names, phone numbers, addresses, and websites.

$49 per month, unlimited searches. Free preview before you pay, no card required.

https://mapzap.org

Happy to answer questions.`
  },
  {
    title: "Built a tool for cold outreach prospecting — 100 local business leads in 60 seconds, $49/month unlimited",
    text: `If you do any kind of cold outreach you know how painful it is to build lead lists manually.

I built MapZap to fix that. Type any business niche and city, get 100 leads as a downloadable CSV instantly. Name, phone, address, website.

Use cases: cold callers, agencies building client lists, freelancers finding local prospects, sales reps targeting specific niches.

$49 per month, unlimited searches. Try 5 leads free first.

https://mapzap.org`
  },
  {
    title: "MapZap — pull 100 local business leads from Google Maps in 60 seconds — $49/month unlimited searches",
    text: `Sharing something I built that has been useful for cold outreach.

You type a business type and city, it hits Google Maps and returns 100 businesses as a CSV with name, phone number, address, and website. Takes about 60 seconds.

$49 per month gets you unlimited searches. There is also a $99 per month Pro tier that includes business emails where available.

Free preview with no credit card: https://mapzap.org`
  },
  {
    title: "Stop building prospect lists by hand — built a tool that pulls 100 local business leads in 60 seconds",
    text: `If you do cold outreach to local businesses you know how slow it is to manually find leads.

I built MapZap to automate it. Type any niche and city, get 100 businesses as a CSV in about a minute. Name, phone number, address, website URL.

Works for any niche — contractors, restaurants, dentists, real estate agents, insurance brokers, gyms, whatever you target.

$49 per month unlimited searches. Free to try first, no card needed.

https://mapzap.org`
  },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function loadBanned() {
  if (!fs.existsSync(BANNED_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(BANNED_PATH)); } catch { return []; }
}

function saveBanned(banned) {
  fs.writeFileSync(BANNED_PATH, JSON.stringify(banned, null, 2));
}

function loadPosted() {
  if (!fs.existsSync(POSTED_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(POSTED_PATH)); } catch { return {}; }
}

function savePosted(posted) {
  fs.writeFileSync(POSTED_PATH, JSON.stringify(posted, null, 2));
}

function wasPostedToday(posted, sub) {
  if (!posted[sub]) return false;
  const last = new Date(posted[sub]);
  const now = new Date();
  return last.toDateString() === now.toDateString();
}

function log(tag, msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`);
}

async function postToSub(sub, type) {
  const post = type === "DEVHIRE" ? pick(DEVHIRE_POSTS) : pick(MAPZAP_POSTS);
  try {
    await reddit.getSubreddit(sub).submitSelfpost({
      title: post.title,
      text: post.text,
    });
    log("POSTED", `r/${sub} [${type}]`);
    return "posted";
  } catch (err) {
    const msg = err.message || "";
    if (
      msg.includes("SUBREDDIT_NOTALLOWED") ||
      msg.includes("BANNED_FROM_SUBREDDIT") ||
      msg.includes("not allowed to post") ||
      msg.includes("forbidden") ||
      msg.includes("403") ||
      msg.includes("FLAIR_REQUIRED") ||
      msg.includes("flair") ||
      msg.includes("SUBREDDIT_NOEXIST") ||
      msg.includes("doesn't exist") ||
      msg.includes("TITLE_REQUIREMENT") ||
      msg.includes("title") ||
      msg.includes("NO_SELFS") ||
      msg.includes("text posts")
    ) {
      log("SKIP", `r/${sub} — blacklisting: ${msg.split(",")[0]}`);
      return "banned";
    }
    if (msg.includes("RATELIMIT") || msg.includes("rate limit")) {
      log("RATELIMIT", `r/${sub} — waiting 15 minutes`);
      await sleep(15 * 60 * 1000);
      return "ratelimit";
    }
    log("ERROR", `r/${sub}: ${msg}`);
    return "error";
  }
}

async function runCycle() {
  const banned = loadBanned();
  const posted = loadPosted();

  const devhireSubs = DEVHIRE_SUBS.filter(s => !banned.includes(s) && !wasPostedToday(posted, s));
  const mapzapSubs = MAPZAP_SUBS.filter(s => !banned.includes(s) && !wasPostedToday(posted, s));

  const queue = [
    ...devhireSubs.map(s => ({ sub: s, type: "DEVHIRE" })),
    ...mapzapSubs.map(s => ({ sub: s, type: "MAPZAP" })),
  ];

  const seen = new Set();
  const deduped = queue.filter(item => {
    if (seen.has(item.sub)) return false;
    seen.add(item.sub);
    return true;
  });

  log("INFO", `${deduped.length} subs to post to today`);

  for (const item of deduped) {
    const result = await postToSub(item.sub, item.type);

    if (result === "banned") {
      const banned = loadBanned();
      if (!banned.includes(item.sub)) {
        banned.push(item.sub);
        saveBanned(banned);
      }
      continue;
    }

    if (result === "posted") {
      const posted = loadPosted();
      posted[item.sub] = new Date().toISOString();
      savePosted(posted);
      const delay = rand(MIN_DELAY_MS, MAX_DELAY_MS);
      log("INFO", `Waiting ${Math.round(delay / 60000)}m before next post...`);
      await sleep(delay);
    }
  }

  log("INFO", "Daily cycle complete. Restarting tomorrow.");
}

(async () => {
  console.log("=".repeat(60));
  console.log("RedditPoster -- Daily Sub Poster");
  console.log("=".repeat(60));

  while (true) {
    await runCycle();
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(8, 0, 0, 0);
    const msUntilTomorrow = tomorrow - now;
    log("INFO", `Next cycle starts at 8am tomorrow. Sleeping ${Math.round(msUntilTomorrow / 3600000)}hrs.`);
    await sleep(msUntilTomorrow);
  }
})();
