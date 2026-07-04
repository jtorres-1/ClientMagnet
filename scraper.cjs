// scraper.cjs — ClientMagnet Lead Scraper
// DEVHIRE + TRADINGBOT only. No lockedIn. No DM sending.
// agency_bot.cjs handles all DM sending.

require("dotenv").config();
const snoowrap = require("snoowrap");
const fs = require("fs");
const path = require("path");
const { createObjectCsvWriter } = require("csv-writer");

const reddit = new snoowrap({
  userAgent:    process.env.REDDIT_USER_AGENT,
  clientId:     process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username:     process.env.REDDIT_USERNAME,
  password:     process.env.REDDIT_PASSWORD,
});

const baseDir   = path.resolve(__dirname, "logs");
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

const leadsPath = path.join(baseDir, "clean_leads.csv");
const usersPath = path.join(baseDir, "contacted_users.json");

const SCRAPE_INTERVAL_MS = 30 * 60 * 1000;

const leadsWriter = createObjectCsvWriter({
  path: leadsPath,
  header: [
    { id: "time",           title: "Time" },
    { id: "username",       title: "Username" },
    { id: "title",          title: "Title" },
    { id: "url",            title: "URL" },
    { id: "subreddit",      title: "Subreddit" },
    { id: "leadType",       title: "Lead Type" },
    { id: "product",        title: "Product" },
    { id: "matchedTrigger", title: "Matched Trigger" },
    { id: "budget",         title: "Budget" },
    { id: "score",          title: "Score" },
  ],
  append: true,
});

function log(tag, msg) { console.log(`[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const seenPostIds = new Set();

function loadContactedUsernames() {
  if (!fs.existsSync(usersPath)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(usersPath, "utf8"));
    return new Set(Object.keys(data));
  } catch { return new Set(); }
}

// ─── DEVHIRE ──────────────────────────────────────────────────────────────────
const DEVHIRE_SUBREDDITS = [
  "forhire",
  "hiring",
  "entrepreneur",
  "smallbusiness",
  "startups",
  "SideProject",
  "webdev",
  "shopify",
  "ecommerce",
  "passive_income",
  "Flipping",
  "socialmedia",
  "digital_marketing",
];

const DEVHIRE_QUERIES = [
  "need a developer",
  "need a programmer",
  "need someone to build",
  "looking for developer",
  "hire a developer",
  "hire a programmer",
  "need a bot built",
  "need automation built",
  "need a website built",
  "need a web app built",
  "need an app built",
  "need a mobile app built",
  "can someone build a bot",
  "willing to pay developer",
  "budget for developer",
  "need someone to code",
  "need a scraper built",
  "need automation help",
  "looking for coder",
  "need a custom tool built",
];

const devHireIntentRegex = /\b(need|want|looking for|hiring|hire|searching for|seeking|require|paid|paying|budget|willing to pay)\b.{0,60}\b(developer|programmer|coder|dev|engineer|builder|freelancer)\b|\b(build|create|make|develop|code|automate|scrape)\b.{0,60}\b(bot|automation|script|tool|app|website|web app|mobile app|dashboard|platform|scraper|integration|workflow|saas)\b|\[H\].{0,100}(developer|programmer|dev|build|app|bot|website)/i;

const devHireExcludeRegex = /\b(i am a|i'm a|i am an|offering|available for hire|available to help|i can build|i build|i develop|i code|my services|my portfolio|hire me|dm me|contact me|i will build|i'll build|i built|i've built|i have built|i am building|i'm building|i am developing|i've developed|already built|already have|already made|working on building|been building|been working on|launched this week|launched recently|check out my|i specialize|looking for work|looking for clients|for hire|freelancer here|open to work)\b/i;

function extractBudget(text) {
  const m = text.match(/\$[\d,]+(?:k)?(?:\/(?:hr|hour|mo|month))?|\d+(?:\.\d+)?(?:k)?\s*(?:dollars|usd|budget)/i);
  return m ? m[0] : "";
}

function scoreDevHire(post, leadType) {
  let score = 50;
  const text = `${post.title} ${post.selftext || ""}`.toLowerCase();
  if (leadType === "DEV_HIRE_URGENT") score += 30;
  if (leadType === "DEV_HIRE_SUBREDDIT") score += 20;
  if (/urgent|asap|immediately|right away|today|tonight|need now/.test(text)) score += 20;
  if (/\$[\d,]+k?|\d+k?\s*(?:usd|dollars|budget)/.test(text)) score += 25;
  if (/bot|automation|scraper|workflow|automate/.test(text)) score += 20;
  if (/website|web app|mobile app|ios|android|app/.test(text)) score += 10;
  if (/paid|paying|budget|fixed fee|flat fee/.test(text)) score += 15;
  if (/startup|agency|business|company|client/.test(text)) score += 10;
  return score;
}

// ─── TRADINGBOT ───────────────────────────────────────────────────────────────
const TRADINGBOT_SUBREDDITS = [
  "algotrading",
  "Daytrading",
  "FuturesTrading",
  "Forex",
  "trading",
  "TradingView",
  "technicalanalysis",
  "Futures",
  "PropFirmTrading",
  "stocks",
  "options",
  "FuturesTrader71",
  "FXtrading",
];

const TRADINGBOT_QUERIES = [
  "automate my trading strategy",
  "trading bot developer",
  "need a trading bot built",
  "hire someone trading bot",
  "custom trading bot",
  "want to automate my strategy",
  "profitable strategy automate",
  "manual strategy automate",
  "algo trading developer",
  "trading bot for hire",
  "pay for trading bot",
  "funded account strategy automate",
  "prop firm strategy bot",
  "mt5 bot developer",
  "tradingview bot developer",
  "my strategy automated",
  "backtested strategy automate",
  "ninjatrader developer",
  "interactive brokers bot",
];

const tradingBotIntentRegex = /\b(automat|bot|algo|algorithm)\b.{0,80}\b(strateg|trade|trading|entry|exit|signal|execution)\b|\b(strateg|setup|system|signal)\b.{0,80}\b(automat|bot|algo|running|execut|passive)\b|\b(profitable|proven|backtested|live|working|manual|tested)\b.{0,60}\b(strateg|system|setup|signal|trade|results)\b|\b(hire|pay|budget|looking for|need someone|need a dev|custom|developer)\b.{0,60}\b(bot|algo|trading bot|automat|script|strategy)\b|\b(funded account|prop firm|topstep|apex|FTMO|combine|passed combine|live account)\b/i;

const tradingBotExcludeRegex = /\b(beginner|just started|new to trading|learning to trade|paper trading only|no money|broke|can't afford|free bot|open source|free strategy|copy trading|signals|i built|i've built|already built|already have|already made|working on building|been working on|launched this week|launched recently)\b/i;

function scoreTradingBot(post) {
  let score = 70;
  const text = `${post.title} ${post.selftext || ""}`.toLowerCase();
  if (/profitable|proven|backtested|live results|years of|track record/.test(text)) score += 30;
  if (/funded|prop firm|topstep|apex|ftmo|combine|live account/.test(text)) score += 25;
  if (/\$[\d,]+k?|\d+k?\s*(?:usd|dollars|budget)|willing to pay|paying|hire|flat fee/.test(text)) score += 35;
  if (/automate|running automatically|hands off|passive|24\/7/.test(text)) score += 20;
  if (/futures|nq|es|gc|gold|forex|eur|gbp|gbpusd|eurusd/.test(text)) score += 10;
  if (/mt4|mt5|tradingview|ninjatrader|thinkorswim|interactive brokers|ibkr|projectx/.test(text)) score += 15;
  if (/strategy|system|setup|edge|alpha/.test(text)) score += 10;
  return score;
}

// ─── SCRAPE SUBREDDIT ─────────────────────────────────────────────────────────
async function scrapeSubreddit(subredditName, product) {
  const newLeads = [];
  try {
    const posts = await reddit.getSubreddit(subredditName).getNew({ limit: 50 });
    const contactedUsers = loadContactedUsernames();

    for (const post of posts) {
      if (seenPostIds.has(post.id)) continue;
      seenPostIds.add(post.id);

      const author = post.author?.name;
      if (!author || author === "[deleted]" || author === "AutoModerator") continue;
      if (contactedUsers.has(author.toLowerCase())) continue;

      const fullText = `${post.title} ${post.selftext || ""}`;

      if (product === "DEVHIRE") {
        if (!devHireIntentRegex.test(fullText)) continue;
        if (devHireExcludeRegex.test(fullText)) continue;
        const isUrgent = /urgent|asap|immediately|right away|need now/i.test(fullText);
        const leadType = isUrgent ? "DEV_HIRE_URGENT" : "DEV_HIRE_SUBREDDIT";
        const budget = extractBudget(fullText);
        const score = scoreDevHire(post, leadType);
        newLeads.push({
          time: new Date().toISOString(), username: author,
          title: post.title.slice(0, 150), url: `https://reddit.com${post.permalink}`,
          subreddit: subredditName, leadType, product: "DEVHIRE",
          matchedTrigger: "subreddit_scan", budget, score,
        });
        log("LEAD", `[DEVHIRE] u/${author} in r/${subredditName} | score:${score} | ${post.title.slice(0, 60)}`);
      }

      if (product === "TRADINGBOT") {
        if (!tradingBotIntentRegex.test(fullText)) continue;
        if (tradingBotExcludeRegex.test(fullText)) continue;
        const score = scoreTradingBot(post);
        const budget = extractBudget(fullText);
        newLeads.push({
          time: new Date().toISOString(), username: author,
          title: post.title.slice(0, 150), url: `https://reddit.com${post.permalink}`,
          subreddit: subredditName, leadType: "TRADING_BOT", product: "TRADINGBOT",
          matchedTrigger: "subreddit_scan", budget, score,
        });
        log("LEAD", `[TRADINGBOT] u/${author} in r/${subredditName} | score:${score} | ${post.title.slice(0, 60)}`);
      }
    }
  } catch (err) {
    log("ERROR", `r/${subredditName} failed: ${err.message}`);
  }
  return newLeads;
}

// ─── GLOBAL SEARCH ────────────────────────────────────────────────────────────
async function globalSearch(query, product) {
  const newLeads = [];
  try {
    const results = await reddit.search({ query, sort: "new", time: "day", limit: 25 });
    const contactedUsers = loadContactedUsernames();

    for (const post of results) {
      if (seenPostIds.has(post.id)) continue;
      seenPostIds.add(post.id);

      const author = post.author?.name;
      if (!author || author === "[deleted]" || author === "AutoModerator") continue;
      if (contactedUsers.has(author.toLowerCase())) continue;

      const fullText = `${post.title} ${post.selftext || ""}`;

      if (product === "DEVHIRE") {
        if (!devHireIntentRegex.test(fullText)) continue;
        if (devHireExcludeRegex.test(fullText)) continue;
        const isUrgent = /urgent|asap|immediately|right away|need now/i.test(fullText);
        const leadType = isUrgent ? "DEV_HIRE_URGENT" : "DEV_HIRE_GLOBAL";
        const budget = extractBudget(fullText);
        const score = scoreDevHire(post, leadType);
        newLeads.push({
          time: new Date().toISOString(), username: author,
          title: post.title.slice(0, 150), url: `https://reddit.com${post.permalink}`,
          subreddit: post.subreddit?.display_name || "unknown",
          leadType, product: "DEVHIRE", matchedTrigger: query, budget, score,
        });
        log("LEAD", `[DEVHIRE/GLOBAL] u/${author} | "${query}" | score:${score}`);
      }

      if (product === "TRADINGBOT") {
        if (!tradingBotIntentRegex.test(fullText)) continue;
        if (tradingBotExcludeRegex.test(fullText)) continue;
        const score = scoreTradingBot(post);
        const budget = extractBudget(fullText);
        newLeads.push({
          time: new Date().toISOString(), username: author,
          title: post.title.slice(0, 150), url: `https://reddit.com${post.permalink}`,
          subreddit: post.subreddit?.display_name || "unknown",
          leadType: "TRADING_BOT", product: "TRADINGBOT", matchedTrigger: query, budget, score,
        });
        log("LEAD", `[TRADINGBOT/GLOBAL] u/${author} | "${query}" | score:${score}`);
      }
    }
  } catch (err) {
    log("ERROR", `Search "${query}" failed: ${err.message}`);
  }
  return newLeads;
}

// ─── MAIN SCRAPE CYCLE ────────────────────────────────────────────────────────
async function runScrapeCycle() {
  log("INFO", "Scrape cycle starting...");
  const allLeads = [];

  for (const sub of DEVHIRE_SUBREDDITS) {
    const leads = await scrapeSubreddit(sub, "DEVHIRE");
    allLeads.push(...leads);
    await sleep(3000);
  }
  for (const sub of TRADINGBOT_SUBREDDITS) {
    const leads = await scrapeSubreddit(sub, "TRADINGBOT");
    allLeads.push(...leads);
    await sleep(3000);
  }
  for (const query of DEVHIRE_QUERIES) {
    const leads = await globalSearch(query, "DEVHIRE");
    allLeads.push(...leads);
    await sleep(2500);
  }
  for (const query of TRADINGBOT_QUERIES) {
    const leads = await globalSearch(query, "TRADINGBOT");
    allLeads.push(...leads);
    await sleep(2500);
  }

  if (allLeads.length > 0) {
    await leadsWriter.writeRecords(allLeads);
    log("INFO", `Wrote ${allLeads.length} new leads to CSV.`);
  } else {
    log("INFO", "No new leads this cycle.");
  }
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────
(async () => {
  console.log("=".repeat(60));
  console.log("ClientMagnet Scraper — DEVHIRE + TRADINGBOT");
  console.log("=".repeat(60));

  while (true) {
    await runScrapeCycle();
    log("INFO", `Next scrape in ${SCRAPE_INTERVAL_MS / 60000} minutes.`);
    await sleep(SCRAPE_INTERVAL_MS);
  }
})();
