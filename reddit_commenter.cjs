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

const CYCLE_INTERVAL_MS = 20 * 60 * 1000;
const MIN_DELAY_MS = 4 * 60 * 1000;
const MAX_DELAY_MS = 7 * 60 * 1000;
const MAX_COMMENTS_PER_CYCLE = 15;

const DEVHIRE_QUERIES = [
  "I need a website for my business",
  "I need someone to build my website",
  "I need a website built",
  "I need a developer",
  "I need to hire a developer",
  "I need a web developer",
  "I need automation for my business",
  "I need a bot built",
  "I need a scraper built",
  "I need a python developer",
  "I need someone to build my app",
  "I need a landing page built",
  "I need a shopify store built",
  "I need a wordpress site built",
  "I need a mobile app built",
  "I need a full stack developer",
  "I need someone to fix my website",
  "I need a React developer",
  "I need someone to automate",
  "I need a Discord bot built",
  "I need a Chrome extension built",
  "I need someone to build a tool",
  "I need a SaaS built",
  "I need a dashboard built",
  "I need API integration built",
  "I need someone to build my MVP",
  "I need a developer this week",
  "I need a web app built",
  "I need an AI tool built",
  "looking for a developer to hire",
  "hiring a python developer",
  "need a freelance developer",
  "need someone to code",
  "need a programmer",
];

const MAPZAP_QUERIES = [
  "I need leads for my business",
  "I need more clients for my business",
  "I need local business leads",
  "I need a lead list",
  "how do I find leads for my business",
  "I need more customers for my business",
  "I need business leads",
  "how do I get more clients",
  "I need to find more customers",
  "I need prospects for my business",
  "I need to generate leads",
  "I need to find businesses in my area",
  "I need phone numbers for businesses",
  "I need to contact local businesses",
  "I need to find local business owners",
  "struggling to find clients",
  "need more sales",
  "need cold outreach list",
  "need a prospect list",
];

const DEVHIRE_COMMENTS = [
  `python dev in LA here, i build websites, scrapers, automation bots, and AI integrations. flat fee, 48 hour delivery. recent work: mapzap.org (live SaaS) and claudiascleaningla.com. DM me a scope`,
  `i can help with this. python developer in LA, available now. websites, scrapers, bots, AI integrations. flat fee only, 48hr delivery. built mapzap.org and claudiascleaningla.com as recent examples. DM me what you need`,
  `python dev available this week. i build websites, automation bots, scrapers, AI integrations. flat fee, 48 hour turnaround. DM me a scope and i'll tell you if i can build it`,
  `this is exactly what i do. python and node.js developer in LA. websites, scrapers, bots, AI integrations, 48hr delivery, flat fee. $500 websites, $800 automation. DM me`,
  `available for this. python dev, LA based. built live production tools including a google maps SaaS and automation pipelines. flat fee, 48hr delivery. DM me what you need built`,
];

const MAPZAP_COMMENTS = [
  `this might help, built mapzap.org, pulls 100 local business leads from Google Maps in 60 seconds as a CSV. name, phone, address, website. $49/month unlimited searches, free preview no card needed`,
  `built something for exactly this — mapzap.org scrapes 100 local businesses from Google Maps in 60 seconds. type a niche and city, get a CSV instantly. $49/month unlimited, free preview available`,
  `mapzap.org might solve this. pulls 100 local business leads in 60 seconds from Google Maps. CSV with name, phone, address, website. $49/month unlimited searches, free to try first`,
  `i built a tool for this, mapzap.org. type any business type and city, get 100 leads as a CSV in 60 seconds. name, phone, address, website. $49/month unlimited, no card needed for preview`,
  `built mapzap.org for this exact problem. 100 local business leads from Google Maps in 60 seconds as a downloadable CSV. $49/month unlimited searches, free preview available at mapzap.org`,
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
