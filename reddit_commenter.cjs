require("dotenv").config();
const fs = require("fs");
const path = require("path");
const snoowrap = require("snoowrap");

const reddit = new snoowrap({
  userAgent: process.env.REDDIT_USER_AGENT,
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
});

const baseDir = path.resolve(__dirname, "logs");
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

const BANNED_PATH = path.join(baseDir, "banned_subs.json");
const COMMENTED_PATH = path.join(baseDir, "commented_posts.json");

const CYCLE_INTERVAL_MS = 10 * 60 * 1000;
const MIN_DELAY_MS = 2 * 60 * 1000;
const MAX_DELAY_MS = 4 * 60 * 1000;
const MAX_COMMENTS_PER_CYCLE = 25;

const DEVHIRE_QUERIES = [
  // Direct hiring posts
  "looking for a developer",
  "looking for a web developer",
  "looking for a python developer",
  "looking to hire a developer",
  "want to hire a developer",
  "need to hire a developer",
  // Problem statements that lead to hiring
  "how much does it cost to build a website",
  "how much to build an app",
  "how do I build a website for my business",
  "should I hire a developer",
  "where to find a developer",
  "how to find a good developer",
  "my website is broken",
  "need help with my website",
  "need help building my website",
  "need help building my app",
  "need help automating",
  "how to automate my business",
  "looking for technical cofounder",
  "need technical help",
  "need a developer for my startup",
  "need a developer for my business",
  "how to build a chatbot",
  "need to build a bot",
  "need to scrape data",
  "need to build an api",
  "need a website for my startup",
  "need a website for my company",
  "need someone to build my website",
  "need someone to build my app",
  "need someone to build my bot",
  "how to build a saas",
  "need to build an mvp",
];

const MAPZAP_QUERIES = [
  // Direct need statements
  "need more leads for my business",
  "need local business leads",
  "need a lead list",
  "need more clients for my business",
  "need more customers for my business",
  // Problem statements
  "how do I find leads for my business",
  "how to get more clients",
  "how to find more customers",
  "struggling to find clients",
  "struggling to get leads",
  "how to generate leads for my business",
  "where to find business leads",
  "how to build a prospect list",
  "how to do cold outreach",
  "need outreach list",
  "how to find local businesses",
  "how to contact local businesses",
  "need more sales for my business",
  "how to grow my agency",
  "need more clients for my agency",
];

const DEVHIRE_COMMENTS = [
  `python dev in LA here, i build websites, scrapers, automation bots, and AI integrations. flat fee, 48 hour delivery. recent work: [mapzap.org](https://mapzap.org) and [claudiascleaningla.com](https://claudiascleaningla.com). DM me a scope`,
  `i can help with this. python developer in LA, available now. websites, scrapers, bots, AI integrations. flat fee only, 48hr delivery. built [mapzap.org](https://mapzap.org) and [claudiascleaningla.com](https://claudiascleaningla.com) as recent examples. DM me what you need`,
  `python dev available this week. i build websites, automation bots, scrapers, AI integrations. flat fee, 48 hour turnaround. DM me a scope and i'll tell you if i can build it`,
  `this is exactly what i do. python and node.js developer in LA. websites, scrapers, bots, AI integrations, 48hr delivery, flat fee. $500 websites, $800 automation. DM me`,
  `available for this. python dev, LA based. built live production tools including a google maps SaaS and automation pipelines. flat fee, 48hr delivery. DM me what you need built`,
];

const MAPZAP_COMMENTS = [
  `this might help, built [mapzap.org](https://mapzap.org), pulls 100 local business leads from Google Maps in 60 seconds as a CSV. name, phone, address, website. $49/month unlimited searches, free preview no card needed`,
  `built something for exactly this — [mapzap.org](https://mapzap.org) scrapes 100 local businesses from Google Maps in 60 seconds. type a niche and city, get a CSV instantly. $49/month unlimited, free preview available`,
  `[mapzap.org](https://mapzap.org) might solve this. pulls 100 local business leads in 60 seconds from Google Maps. CSV with name, phone, address, website. $49/month unlimited searches, free to try first`,
  `i built a tool for this, [mapzap.org](https://mapzap.org). type any business type and city, get 100 leads as a CSV in 60 seconds. name, phone, address, website. $49/month unlimited, no card needed for preview`,
  `built [mapzap.org](https://mapzap.org) for this exact problem. 100 local business leads from Google Maps in 60 seconds as a downloadable CSV. $49/month unlimited searches, free preview available at [mapzap.org](https://mapzap.org)`,
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function log(tag, msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`;
  console.log(line);
}

function loadBanned() {
  if (!fs.existsSync(BANNED_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(BANNED_PATH)); } catch { return []; }
}

function loadCommented() {
  if (!fs.existsSync(COMMENTED_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(COMMENTED_PATH)); } catch { return {}; }
}

function saveCommented(commented) {
  fs.writeFileSync(COMMENTED_PATH, JSON.stringify(commented, null, 2));
}

function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 24;
}

const wait = ms => new Promise(res => setTimeout(res, ms));

async function runCycle() {
  const banned = loadBanned();
  const commented = loadCommented();
  let commentsThisCycle = 0;

  const allQueries = [
    ...DEVHIRE_QUERIES.map(q => ({ query: q, type: "DEVHIRE" })),
    ...MAPZAP_QUERIES.map(q => ({ query: q, type: "MAPZAP" })),
  ];

  // Shuffle queries each cycle
  allQueries.sort(() => Math.random() - 0.5);

  for (const { query, type } of allQueries) {
    if (commentsThisCycle >= MAX_COMMENTS_PER_CYCLE) {
      log("INFO", `Hit max comments (${MAX_COMMENTS_PER_CYCLE}). Stopping cycle.`);
      break;
    }

    log("SEARCH", `"${query}" [${type}]`);

    try {
      await wait(2000);
      const posts = await reddit.search({
        query,
        sort: "new",
        time: "day",
        limit: 100,
      });

      for (const post of posts) {
        if (commentsThisCycle >= MAX_COMMENTS_PER_CYCLE) break;
        if (!post.author || !isFresh(post)) continue;

        // Skip banned subs
        const subName = post.subreddit?.display_name || post.subreddit;
        if (banned.some(b => b.toLowerCase() === subName?.toLowerCase())) {
          log("SKIP", `Banned sub r/${subName}`);
          continue;
        }

        // Skip already commented
        const postId = post.id || post.name;
        if (commented[postId]) {
          log("SKIP", `Already commented on ${postId}`);
          continue;
        }

        // Skip if post author is our bot
        if (post.author?.name?.toLowerCase() === (process.env.REDDIT_USERNAME || "").toLowerCase()) continue;

        // Block obviously wrong subreddits
        const BLOCK_SUBS = [
          "autisticwithadhd","autism","adhd","mentalhealth","depression","anxiety",
          "relationship_advice","relationships","amitheasshole","tifu","askreddit",
          "gopro","gaming","politics","news","worldnews","funny","pics","videos",
          "science","technology","history","books","movies","music","sports",
          "fitness","loseit","food","cooking","travel","personalfinance",
          "legaladvice","medical","health","parenting","teenagers",
          "mildlyinteresting","oddlysatisfying","todayilearned",
          "graphicdesignjobs","forhire","slavelabour","sidehustlesindia",
          "sidehustlepaglu","designjobs","writingjobs","artjobs","photographyjobs",
          "uxdesign","graphic_design","design","art","photography","illustration",
          "freelancedesigners","freelancewriters","hireawriter","hireadesigner",
        ];
        // Must have buyer intent in title specifically
        const titleLower = (post.title || "").toLowerCase();
        const combined = (titleLower + " " + (post.selftext || "")).toLowerCase();

        // Block FOR HIRE posts — people offering services not buying
        const FOR_HIRE_BLOCK = [
          "[for hire]","[offering]","for hire","available for hire","hire me",
          "my services","my rates","my portfolio","i am available","i'm available",
          "anyone need a website","anyone need a developer","anyone need a dev",
          "i build websites","i build apps","i build bots","i make websites",
          "i can build","i can help","i can create","i can develop","i can code",
          "i do web","i do development","i do python","i do react",
          "offering my","offering web","offering dev","offering services",
          "i am a developer","i am a dev","i'm a developer","i'm a dev",
          "i am a programmer","i'm a programmer","i am a web developer",
          "looking for clients","looking for projects","looking for work",
          "taking on clients","taking new clients","open for work",
          "check out my work","check my portfolio","see my work",
          "dm me for","message me for","contact me for",
        ];
        if (FOR_HIRE_BLOCK.some(s => titleLower.includes(s))) {
          log("SKIP", `For hire post skipped r/${subName}`);
          continue;
        }
        // Also check body for seller signals
        const bodyLower = (post.selftext || "").toLowerCase();
        const SELLER_BODY_BLOCK = [
          "i am a developer","i'm a developer","i am a web developer",
          "my portfolio","my github","my work","check out my",
          "i build","i create","i develop","i code","i design",
          "available for hire","open for work","looking for clients",
          "taking on clients","my rate","my pricing","per hour","per project",
        ];
        const bodyIsSeller = SELLER_BODY_BLOCK.filter(s => bodyLower.includes(s)).length >= 2;
        if (bodyIsSeller) {
          log("SKIP", `Seller body signals in post by u/${post.author?.name}`);
          continue;
        }
        if (BLOCK_SUBS.some(b => subName?.toLowerCase().includes(b.toLowerCase()))) {
          log("SKIP", `Blocked sub r/${subName}`);
          continue;
        }

        const DEVHIRE_SIGNALS = [
          "need a developer", "need a dev", "need a programmer", "need a coder",
          "need a web developer", "need a web dev", "need a python dev",
          "need someone to build", "need someone to code", "need someone to make",
          "need someone to create", "need someone to develop",
          "need a website", "need a landing page", "need an app",
          "need a bot", "need a scraper", "need automation",
          "need a shopify", "need a wordpress", "need a react",
          "need a saas", "need a mvp", "need a dashboard",
          "need api", "need a chrome extension", "need a discord bot",
          "need a chatbot", "need ai integration", "need an ai tool",
          "looking for a developer", "looking for a dev", "looking for a programmer",
          "looking for a web developer", "looking for someone to build",
          "looking to hire", "hiring a developer", "hiring a dev",
          "hiring a programmer", "want to hire a dev", "want to hire a developer",
          "need help building", "need help with my website", "need help with my app",
          "need my website", "need my app built", "need a freelance dev",
          "need a full stack", "need a backend", "need a frontend",
          "[hiring]", "budget:", "paying $", "will pay",
        ];
        const MAPZAP_SIGNALS = [
          "need leads", "need more leads", "need a lead list", "need business leads",
          "need more clients", "need more customers", "need prospects",
          "need to generate leads", "need to find businesses",
          "need phone numbers", "need to contact local",
          "struggling to find clients", "struggling to find customers",
          "how do i find leads", "where do i find leads",
          "how to get more clients", "how to get more customers",
          "need cold outreach", "need a prospect list",
          "need to find more customers", "need to find more clients",
          "need local business", "need outreach list",
        ];
        const signals = type === "DEVHIRE" ? DEVHIRE_SIGNALS : MAPZAP_SIGNALS;
        const hasSignalInTitle = signals.some(s => titleLower.includes(s));
        const hasSignalInBody = signals.some(s => combined.includes(s));
        const hasSignal = hasSignalInTitle || hasSignalInBody;
        if (!hasSignal) {
          log("SKIP", `No buyer signal in post by u/${post.author?.name}`);
          continue;
        }

        const commentText = type === "DEVHIRE" ? pick(DEVHIRE_COMMENTS) : pick(MAPZAP_COMMENTS);

        try {
          await post.reply(commentText);
          commented[postId] = new Date().toISOString();
          saveCommented(commented);
          commentsThisCycle++;
          log("COMMENTED", `r/${subName} — u/${post.author?.name} — "${(post.title || "").substring(0, 60)}"`);

          const delay = rand(MIN_DELAY_MS, MAX_DELAY_MS);
          log("INFO", `${commentsThisCycle}/${MAX_COMMENTS_PER_CYCLE} comments. Waiting ${Math.round(delay / 60000)}min...`);
          await sleep(delay);
        } catch (err) {
          const msg = err.message || "";
          if (msg.includes("SUBREDDIT_NOTALLOWED") || msg.includes("BANNED") || msg.includes("forbidden") || msg.includes("403")) {
            log("BANNED", `r/${subName} — adding to banned list`);
            const banned = loadBanned();
            if (!banned.includes(subName)) {
              banned.push(subName);
              fs.writeFileSync(BANNED_PATH, JSON.stringify(banned, null, 2));
            }
          } else if (msg.includes("RATELIMIT") || msg.includes("rate limit")) {
            log("RATELIMIT", `Waiting 15 minutes...`);
            await sleep(15 * 60 * 1000);
          } else {
            log("ERROR", `Comment failed: ${msg}`);
          }
        }

        await wait(rand(2000, 4000));
      }
    } catch (err) {
      log("ERROR", `Search failed for "${query}": ${err.message}`);
      await wait(15000);
    }
  }

  log("INFO", `Cycle complete. Commented on ${commentsThisCycle} posts.`);
}

(async () => {
  console.log("=".repeat(60));
  console.log("RedditCommenter -- Global Comment Bot");
  console.log("=".repeat(60));

  while (true) {
    await runCycle();
    log("INFO", `Next cycle in ${Math.round(CYCLE_INTERVAL_MS / 60000)} minutes.`);
    await sleep(CYCLE_INTERVAL_MS);
  }
})();
