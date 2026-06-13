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
  "Jobs4Bitcoins",
  "PythonJobs",
  "remotepython",
  "freelancing",
  "WorkFromHome",
  "RemoteJobr",
  "learnpython",
  "softwareengineering",
  "programmingJobs",
  "cscareerquestions",
  "experienceddevs",
  "reactjs",
  "django",
  "node",
];

const MAPZAP_SUBS = [
  "growmybusiness",
  "Business_Ideas",
  "microsaas",
  "b2bsales",
  "Emailmarketing",
  "socialmediamarketing",
  "PPC",
  "Mortgages",
  "FulfillmentByAmazon",
  "Flipping",
  "reselling",
  "Affiliatemarketing",
  "passive_income",
  "EntrepreneurRideAlong",
  "sweatystartup",
  "juststart",
  "saas",
  "indiebiz",
  "nocode",
  "sideproject",
];

const CALLDONE_SUBS = [
  "restaurantowners",
  "salons",
  "autorepair",
  "legaladvice",
  "EntrepreneurRideAlong",
  "sweatystartup",
  "HomeImprovement",
  "Plumbing",
  "HVAC",
  "Roofing",
  "Landscaping",
  "personaltraining",
  "Dentistry",
  "MedicalBilling",
];

const AGENCYHIRE_SUBS = [
  "PPC",
  "EntrepreneurRideAlong",
  "socialmediamarketing",
  "Affiliatemarketing",
  "microsaas",
  "b2bsales",
  "growmybusiness",
  "saas",
  "indiebiz",
  "juststart",
];

const AUTOSUB_SUBS = [
  "Entrepreneur",
  "EntrepreneurRideAlong",
  "smallbusiness",
  "microsaas",
  "saas",
  "indiebiz",
  "sideproject",
  "nocode",
  "growmybusiness",
  "juststart",
  "Affiliatemarketing",
  "passive_income",
  "digitalnomad",
  "freelancing",
  "WorkFromHome",
];

const DEVHIRE_POSTS = [
  {
    title: "[FOR HIRE] Python developer, websites, scrapers, bots, AI integrations, flat fee, 48hr delivery",
    text: `Available for freelance work this week.

I build websites, web scrapers, automation bots, and AI integrations. All flat fee, no hourly. 48 hour delivery on most projects.

Things I have shipped: a live SaaS with Stripe payments and Google Maps integration, a cold email pipeline running 500 emails per day, and a Reddit automation bot in production.

Floor: $500 for websites, $800 for automation and scrapers.

DM me what you need built.`
  },
  {
    title: "[FOR HIRE] Python dev in LA, scraping, automation, web apps, AI, ships fast, flat fee",
    text: `Putting this out there. I am a Python developer based in LA available immediately.

I have live production projects running including a Google Maps scraper SaaS, a cold email pipeline, and a Reddit DM automation bot.

I do websites, scrapers, automation, AI integrations. Flat fee only. 48 hour turnaround.

$500 websites, $800 automation, higher for complex builds.

DM me a scope.`
  },
  {
    title: "[FOR HIRE] Freelance Python developer, bots, scrapers, web apps, automation, available now",
    text: `Available for a project this week.

Stack: Python, Flask, Node.js, Puppeteer, OpenAI API, Stripe, PostgreSQL.

Shipped: a live Google Maps lead scraper SaaS, a 500 email per day cold outreach pipeline, a Reddit automation bot, and multiple business websites.

Flat fee. 48 hours. $500 floor for websites, $800 for automation.

DM me what you need.`
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
    title: "Built a tool for cold outreach prospecting, 100 local business leads in 60 seconds, $49/month unlimited",
    text: `If you do any kind of cold outreach you know how painful it is to build lead lists manually.

I built MapZap to fix that. Type any business niche and city, get 100 leads as a downloadable CSV instantly. Name, phone, address, website.

Use cases: cold callers, agencies building client lists, freelancers finding local prospects, sales reps targeting specific niches.

$49 per month, unlimited searches. Try 5 leads free first.

https://mapzap.org`
  },
  {
    title: "MapZap pulls 100 local business leads from Google Maps in 60 seconds, $49/month unlimited searches",
    text: `Sharing something I built that has been useful for cold outreach.

You type a business type and city, it hits Google Maps and returns 100 businesses as a CSV with name, phone number, address, and website. Takes about 60 seconds.

$49 per month gets you unlimited searches.

Free preview with no credit card: https://mapzap.org`
  },
];

const CALLDONE_POSTS = [
  {
    title: "Built an AI receptionist that answers every call 24/7, $500/month, live in 48 hours",
    text: `If you run a business and miss calls when you are busy, on a job, or closed, this is for you.

I built CallDone. It is an AI receptionist that answers every call to your business 24/7. It handles questions, captures caller info, books appointments, and texts you a full summary the second the call ends.

Sounds like a real person. Trained on your specific business, hours, services, and FAQs.

Call the demo line right now and hear it yourself: (563) 287-1146

$500 per month. No setup fee. Live in 48 hours. Cancel anytime.

https://calldone.org`
  },
  {
    title: "Every missed call is a customer going to your competitor, built a fix for that",
    text: `62% of callers will not leave a voicemail. They just call the next business on Google.

I built CallDone to solve this. An AI receptionist that answers every call to your business 24/7. Handles FAQs, captures leads, books appointments, texts you a summary after every call.

Call (563) 287-1146 to hear the demo.

No setup fee. $500 per month. Live in 48 hours or less.

https://calldone.org`
  },
  {
    title: "AI receptionist for small businesses, answers calls 24/7, captures leads, texts you summaries",
    text: `Built this for small business owners who cannot always answer the phone.

CallDone answers every incoming call to your business 24 hours a day, 7 days a week. It handles common questions, takes messages, captures caller info, and sends you a text summary instantly after every call.

Works for any business: restaurants, salons, contractors, real estate agents, dental offices, law firms, gyms, auto shops.

Demo: call (563) 287-1146 and hear the AI answer live.

$500 per month. No contracts. No setup fee. Live in 48 hours.

https://calldone.org`
  },
];

const AGENCYHIRE_POSTS = [
  {
    title: "Built an automated outreach system that sends 1000+ targeted messages per day, taking 2 agency clients this week",
    text: `If you run an agency and do outreach manually, this is worth reading.

I built a 7-channel automated outreach system that runs 24/7 across Reddit, Facebook, Discord, and X. It finds people actively looking for your service and messages them automatically. 1000+ targeted contacts per day.

I use it for my own products and it works. Proof: https://mapzap.org built and marketed entirely with this system.

Taking 2 clients this week to deploy the full stack on their accounts. 48 hour setup. $1,500 flat fee, $500/month retainer after that.

DM me if you want to see exactly how it works. Deposit to get started: https://buy.stripe.com/9B6eVd7vteL23kedQ22Ry0d`
  },
  {
    title: "Automate your agency outreach, 1000+ targeted messages per day across Reddit, Facebook, Discord, X",
    text: `Running an agency means constant outreach. Most agency owners do it manually or pay someone to do it. Neither scales.

I built an automated system that handles it entirely. Finds buyers in your niche, messages them across 4 platforms simultaneously, runs while you sleep.

Deployed on my own products: https://mapzap.org

Setup: $1,500 flat, 48 hour delivery. Monthly retainer: $500 to keep it running and optimized.

Taking a limited number of agency clients this week. DM me a scope.

Start here: https://buy.stripe.com/9B6eVd7vteL23kedQ22Ry0d`
  },
];

const AUTOSUB_POSTS = [
  {
    title: "Built a tool that automates your Reddit outreach, finds buyers and DMs them 24/7, $47/month",
    text: `If you sell anything and use Reddit for outreach, this might save you hours every day.

I built AutoSub. You connect your Reddit account, set your offer and target keywords, and it finds people posting about needing what you sell and DMs them automatically. 200+ targeted messages per day.

Runs 24/7. Live dashboard showing DMs sent and replies received. Cancel anytime.

$47 per month. Try it at autosub.mooo.com`
  },
  {
    title: "Stop doing Reddit DM outreach manually, built a tool that does it automatically",
    text: `I was spending hours every day finding Reddit posts from potential buyers and DMing them manually.

Built AutoSub to fix it. It scrapes Reddit globally for posts matching your buyer keywords and sends your DM automatically. You set it up once and it runs forever.

Works for any niche. Agency owners, freelancers, SaaS founders, service businesses.

$47 per month at autosub.mooo.com`
  },
  {
    title: "AutoSub, automated Reddit DM outreach, connect your account, set keywords, it runs 24/7",
    text: `Sharing something I built for people who do outreach on Reddit.

AutoSub finds people actively posting about needing what you sell and DMs them automatically on your behalf. You connect your Reddit account, write your offer, set your target keywords, and it does the rest.

200+ targeted DMs per day. Live dashboard. Pause anytime.

$47 per month. autosub.mooo.com`
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
  let post;
  if (type === "DEVHIRE") post = pick(DEVHIRE_POSTS);
  else if (type === "CALLDONE") post = pick(CALLDONE_POSTS);
  else if (type === "AGENCYHIRE") post = pick(AGENCYHIRE_POSTS);
  else if (type === "AUTOSUB") post = pick(AUTOSUB_POSTS);
  else post = pick(MAPZAP_POSTS);

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
      log("SKIP", `r/${sub} blacklisting: ${msg.split(",")[0]}`);
      return "banned";
    }
    if (msg.includes("RATELIMIT") || msg.includes("rate limit")) {
      log("RATELIMIT", `r/${sub} waiting 15 minutes`);
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
  const calldoneSubs = CALLDONE_SUBS.filter(s => !banned.includes(s) && !wasPostedToday(posted, s));
  const agencyhireSubs = AGENCYHIRE_SUBS.filter(s => !banned.includes(s) && !wasPostedToday(posted, s));
  const autosubSubs = AUTOSUB_SUBS.filter(s => !banned.includes(s) && !wasPostedToday(posted, s));

  const queue = [
    ...devhireSubs.map(s => ({ sub: s, type: "DEVHIRE" })),
    ...mapzapSubs.map(s => ({ sub: s, type: "MAPZAP" })),
    ...calldoneSubs.map(s => ({ sub: s, type: "CALLDONE" })),
    ...agencyhireSubs.map(s => ({ sub: s, type: "AGENCYHIRE" })),
    ...autosubSubs.map(s => ({ sub: s, type: "AUTOSUB" })),
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
