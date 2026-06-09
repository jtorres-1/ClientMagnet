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
  "slavelabour",
  "freelance_forhire",
  "webdevjobs",
  "WorkOnline",
  "PythonJobs",
  "reactjs",
  "nodejs",
  "webdev",
  "Python",
  "learnprogramming",
  "startups",
  "Entrepreneur",
  "smallbusiness",
  "SideProject",
  "indiehackers",
  "IMadeThis",
  "programming",
  "softwareengineering",
  "cscareerquestions",
  "freelancing",
  "digitalnomad",
  "RemoteWork",
];

const MAPZAP_SUBS = [
  "sales",
  "coldemail",
  "leadgeneration",
  "digital_marketing",
  "Emailmarketing",
  "b2bmarketing",
  "agency",
  "realtors",
  "InsuranceAgent",
  "ecommerce",
  "dropship",
  "Flipping",
  "msp",
  "marketing",
  "socialmedia",
  "SEO",
  "Affiliatemarketing",
  "entrepreneurs",
  "smallbusiness",
  "Business_Ideas",
  "passive_income",
  "hustle",
  "sidehustle",
  "Entrepreneur",
  "startups",
];

const DEVHIRE_POSTS = [
  {
    title: "[offer] Python Developer in LA | Websites, Scrapers, Bots, AI Integrations | 48hr Delivery | Flat Fee",
    text: `Hey everyone, I am a Python developer based in Los Angeles available for immediate freelance work.

What I build:
- Business websites (48 hour delivery)
- Custom scrapers and data pipelines
- Automation bots
- AI integrations
- Cold outreach systems


Flat fee, no hourly rates. 50% deposit upfront, 50% on delivery.

Floor pricing: $500 websites, $800 automation.

DM me a scope and I will get back to you immediately.`
  },
  {
    title: "[offer] Full Stack Developer | Python, Node.js, React | Bots, Scrapers, Web Apps | 48hr Turnaround",
    text: `Python and Node.js developer available for freelance projects right now.

I have built and shipped:
- A live Google Maps lead scraper SaaS with Stripe payments
- A cold email pipeline pushing 500 emails per day
- A Reddit automation bot in production
- Multiple business websites delivered in 48 hours

Tech stack: Python, Flask, Node.js, React, Puppeteer, PostgreSQL, Stripe, OpenAI API.


Flat fee only. No hourly. DM me what you need built.`
  },
  {
    title: "[offer] Python Dev | Automation, Scrapers, AI, Websites | LA Based | Fast Delivery",
    text: `Available for freelance work immediately.

Specialties:
- Web scraping and data pipelines
- Automation bots
- AI integrations with OpenAI
- Business websites in 48 hours
- Cold outreach systems

Flat fee. 48 hour delivery. $500 floor for websites, $800 for automation.


DM me a scope.`
  },
];

const MAPZAP_POSTS = [
  {
    title: "I built a tool that pulls 100 local business leads as a CSV in 60 seconds",
    text: `Hey, wanted to share something I built that might help people here.

It is called MapZap. You type a business type and city, it pulls 100 local businesses from Google Maps and exports a CSV with names, phone numbers, addresses, and websites in about 60 seconds.

Useful for:
- Cold outreach lists
- Sales prospecting
- Market research
- Lead generation agencies

$49 one time, no subscription. First 5 leads free.

https://mapzap.org

Happy to answer any questions.`
  },
  {
    title: "Stop building lead lists manually. I automated it.",
    text: `Built a tool that scrapes 100 local business leads from Google Maps in under a minute.

Type a niche and city, get a CSV with:
- Business name
- Phone number
- Address
- Website

One time $49. No monthly fee. No limits on searches after you pay.

Free trial, no credit card needed.

https://mapzap.org`
  },
  {
    title: "Tool I built for cold outreach prospecting: 100 leads in 60 seconds",
    text: `Been doing cold outreach for a while and got tired of manually building lists so I built something to automate it.

Enter any business type and city, get 100 leads as a downloadable CSV instantly. Name, phone, address, website.

Use cases:
- Local business outreach
- B2B prospecting
- Agency lead gen
- Sales pipelines

$49 flat, no subscription. First 5 leads free so you can check data quality before buying.

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
      msg.includes("title")
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
