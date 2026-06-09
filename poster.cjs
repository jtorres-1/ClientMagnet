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

const DEVHIRE_SUBS = [
  "forhire",
  "freelance_forhire",
  "jobbit",
  "slavelabour",
  "WorkOnline",
  "PythonJobs",
  "MachineLearningJobs",
  "remotepython",
  "webdevjobs",
  "techjobs",
  "cscareerquestionsEU",
  "freelancing",
  "digitalnomad",
  "RemoteWork",
  "beermoney",
  "Jobs4Bitcoins",
  "HireaWriter",
  "hireadev",
  "SideProject",
  "IMadeThis",
  "softwareengineering",
  "cscareerquestions",
  "learnprogramming",
  "webdev",
  "django",
  "flask",
  "Python",
  "javascript",
  "reactjs",
  "node",
];

const MAPZAP_SUBS = [
  "agency",
  "Flipping",
  "Affiliatemarketing",
  "entrepreneurs",
  "Business_Ideas",
  "passive_income",
  "hustle",
  "sidehustle",
  "EntrepreneurRideAlong",
  "sweatystartup",
  "growmybusiness",
  "juststart",
  "copywriting",
  "cold_email",
  "automation",
  "recruiting",
  "realestateinvesting",
  "InsuranceAgents",
  "coldemail",
  "smallbusiness",
  "sales",
  "leadgeneration",
  "digital_marketing",
  "Emailmarketing",
  "b2bmarketing",
  "msp",
  "marketing",
  "ecommerce",
  "dropship",
  "FulfillmentByAmazon",
  "AmazonSeller",
  "reselling",
  "PPC",
  "FacebookAds",
  "googleads",
  "shopify",
  "Wordpress",
  "realtors",
];

const DEVHIRE_POSTS = [
  {
    title: "[FOR HIRE] Python dev in LA — websites, scrapers, bots, AI integrations — fast turnaround, flat fee",
    text: `Hey, putting this out there — I'm a Python developer based in LA with availability this week.

Built some things I'm proud of: a live Google Maps lead scraper SaaS with Stripe payments, a cold email pipeline pushing 500 emails per day, and a Reddit automation bot all running in production.

Looking for a project to work on. Websites, scrapers, automation bots, AI integrations. Flat fee only, no hourly. 48 hour delivery on most projects.

Floor pricing: $500 for websites, $800 for automation and scrapers.

Portfolio: https://casa-fuego-demo.netlify.app

DM me what you need built.`
  },
  {
    title: "[FOR HIRE] Available now — Python, Node.js, automation, web apps — LA based dev, ships fast",
    text: `I'm a developer based in Los Angeles available for freelance work right now.

What I actually build and ship: web scrapers, automation bots, cold outreach pipelines, business websites, AI integrations. Not theory — I have live production projects running.

48 hour turnaround. Flat fee. No hourly rates ever.

$500 minimum for websites, $800 for automation.

Portfolio: https://casa-fuego-demo.netlify.app

DM me a scope and I'll tell you if I can build it.`
  },
  {
    title: "[FOR HIRE] Freelance Python developer — scraping, automation, bots, web apps — flat fee, fast delivery",
    text: `Throwing this out there — I'm a Python dev in LA looking for a project this week.

Stuff I've shipped: a Google Maps scraper SaaS that pulls 100 leads in 60 seconds, email outreach pipelines, Reddit bots, business websites. All running in production.

Flat fee. 48 hours. No subscriptions on my end, no hourly, no retainers unless you want one.

$500 websites, $800 automation, higher for complex builds.

DM me what you're trying to build.`
  },
];

const MAPZAP_POSTS = [
  {
    title: "I got tired of building lead lists manually so I built a tool that does it in 60 seconds",
    text: `Been doing cold outreach for a while and kept wasting hours manually finding local business leads. Finally built something to fix it.

MapZap pulls 100 local businesses from Google Maps in about 60 seconds. Type a business type and city, get a CSV with names, phone numbers, addresses, and websites.

$49 per month, unlimited searches. Free preview before you pay — no card required.

https://mapzap.org

Happy to answer questions.`
  },
  {
    title: "Built a tool for cold outreach prospecting — 100 local business leads in 60 seconds, $49/month unlimited",
    text: `If you do any kind of cold outreach you know how painful it is to build lead lists manually.

I built MapZap to fix that. Type any business niche and city, get 100 leads as a downloadable CSV instantly. Name, phone, address, website.

Use cases I've seen: cold callers, agencies building client lists, freelancers finding local prospects, sales reps targeting specific niches.

$49 per month, unlimited searches. Try 5 leads free first.

https://mapzap.org`
  },
  {
    title: "MapZap — pull 100 local business leads from Google Maps in 60 seconds — $49/month unlimited searches",
    text: `Sharing something I built that's been useful for cold outreach.

You type a business type and city, it hits Google Maps and returns 100 businesses as a CSV — name, phone number, address, website. Takes about 60 seconds.

Monthly subscription at $49 gets you unlimited searches. There's also a $99/month Pro tier that includes business emails where available.

Free preview with no credit card: https://mapzap.org`
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
