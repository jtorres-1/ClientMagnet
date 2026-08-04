// scraper.cjs — ClientMagnet Lead Scraper
// DEVHIRE + TRADINGBOT only. No lockedIn. No DM sending.
// agency_bot.cjs handles all DM sending.
//
// CHANGES IN THIS VERSION:
// - LLM classification layer removed entirely. Regex now carries full
//   classification weight — no Ollama/ngrok dependency, no Mac uptime
//   requirement, no silent-fallback risk.
// - devHireIntentRegex tightened: the build-verb branch now requires a
//   hiring verb nearby, not just any mention of building something.
//   Fixes false positives like "I'm trying to build a scraper for my
//   own project" matching as a lead.
// - referralRegex added: "does anyone know a good developer" style posts
//   now count as leads (confirmed in scope).
// - firstPersonOwnershipRegex added as a structural backstop to the
//   static exclude list, catches "I'm currently building/working on/
//   attempting to build" phrasing the static list doesn't enumerate.
// - noCashCompRegex added: equity-only / revenue-share-only posts are
//   explicitly excluded (confirmed out of scope).
// - devShopSubcontractRegex added: posts from dev shops/agencies looking
//   to subcontract overflow work are explicitly excluded (confirmed out
//   of scope) — distinct from a regular business with real budget, which
//   still passes via hasBusinessContext.
// - hasMoneySignal now negation-aware: "no budget," "can't afford,"
//   "unpaid" near a money term no longer counts as a money signal.
// - seenPostIds is now keyed per-product (`${post.id}_${product}`)
//   instead of globally. Previously a post matching DEVHIRE first would
//   silently never be evaluated for TRADINGBOT, and vice versa.
// - contacted-users JSON is now loaded once per scrape cycle instead of
//   once per subreddit call (was ~26 redundant disk reads per cycle).
// - Dead/banned subreddits removed from TRADINGBOT_SUBREDDITS (r/Futures
//   private, r/PropFirmTrading and r/FXtrading banned as of last check).
//   Replaced with live alternatives.

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
    { id: "moneySignal",    title: "Money Signal" },
    { id: "selftext",       title: "Selftext" },
  ],
  append: true,
});

function log(tag, msg) { console.log(`[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Per-product post tracking. Keyed by `${postId}_${product}` so a post
// that matches DEVHIRE gets independently evaluated for TRADINGBOT too.
const seenPostKeys = new Set();

function loadContactedUsernames() {
  if (!fs.existsSync(usersPath)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(usersPath, "utf8"));
    return new Set(Object.keys(data));
  } catch { return new Set(); }
}

// ─── TAG FILTER ────────────────────────────────────────────────────────────────
function checkTagFilter(title) {
  const t = (title || "").toLowerCase();
  if (/\[for ?hire\]|\[offer\]|\[services\]|\[available\]|\[freelancer\]/i.test(t)) return "REJECT";
  if (/\[task\]|\[hiring\]|\[request\]|\[job\]/i.test(t)) return "PASS";
  return "NEUTRAL";
}

// ─── MONEY SIGNAL (negation-aware) ─────────────────────────────────────────────
function hasMoneySignal(text) {
  const moneyRegex = /\$[\d,]+k?|\d+k?\s*(?:usd|dollars)|budget of|paying \$|willing to pay|flat fee|our budget|client budget|\d+\/hr|\d+\/hour|compensation|paid position|paid project|paid work/i;
  const match = text.match(moneyRegex);
  if (!match) return false;
  const windowStart = Math.max(0, match.index - 25);
  const before = text.slice(windowStart, match.index);
  if (/\b(no|not|n't|zero|without|can'?t afford|unpaid|lacking)\b/i.test(before)) return false;
  return true;
}

// ─── BUSINESS CONTEXT ──────────────────────────────────────────────────────────
function hasBusinessContext(text) {
  return /\bour (store|company|team|clients|business|shop|agency)\b|\bwe (have|do|run|sell|operate)\b|\d+\s*employees|monthly revenue|our revenue|our customers|existing (business|store|shop|clients)/i.test(text);
}

// ─── DEVHIRE ──────────────────────────────────────────────────────────────────
const DEVHIRE_SUBREDDITS = [
  "forhire", "hiring", "entrepreneur", "smallbusiness", "startups",
  "SideProject", "webdev", "shopify", "ecommerce", "passive_income",
  "Flipping", "socialmedia", "digital_marketing",
];

const DEVHIRE_QUERIES = [
  "need a developer", "need a programmer", "need someone to build",
  "looking for developer", "hire a developer", "hire a programmer",
  "need a bot built", "need automation built", "need a website built",
  "need a web app built", "need an app built", "need a mobile app built",
  "can someone build a bot", "willing to pay developer", "budget for developer",
  "need someone to code", "need a scraper built", "need automation help",
  "looking for coder", "need a custom tool built", "does anyone know a good developer",
];

const devHireIntentRegex = /\b(need|want|looking for|hiring|hire|searching for|seeking|require|paid|paying|budget|willing to pay)\b.{0,60}\b(developer|programmer|coder|dev|engineer|builder|freelancer)\b|\b(need|want|looking for|hiring|hire|require|willing to pay|can (someone|anyone))\b.{0,60}\b(build|create|make|develop|code|automate|scrape)\b.{0,80}\b(bot|automation|script|tool|app|website|web app|mobile app|dashboard|platform|scraper|integration|workflow|saas)\b|\[H\].{0,100}(developer|programmer|dev|build|app|bot|website)/i;

const referralRegex = /\b(does anyone know|can anyone recommend|who('s| is) a good|looking for recommendations for|any recommendations for)\b.{0,40}\b(developer|programmer|coder|dev|agency|freelancer)\b/i;

const devHireExcludeRegex = /\b(i am a|i'm a|i am an|offering|available for hire|available to help|i can build|i build|i develop|i code|my services|my portfolio|hire me|dm me|contact me|i will build|i'll build|i built|i've built|i have built|i am building|i'm building|i am developing|i've developed|already built|already have|already made|working on building|been building|been working on|launched this week|launched recently|check out my|i specialize|looking for work|looking for clients|for hire|freelancer here|open to work|reach out|my rates|\$\d+\/hr|\$\d+\/hour|years of experience|check my profile|check out my profile|dm me for rates|open to opportunities|available for freelance|available for contract|portfolio:|my github|full stack developer here|backend developer here|frontend developer here|senior developer here|available immediately|taking on new clients|booking now|currently accepting clients|slide into my dms|rates start at)\b/i;

const firstPersonOwnershipRegex = /\bi(?:'m| am)\s+(?:currently\s+)?(?:trying to |working on |attempting to |learning to |going to )?(?:build(?:ing)?|develop(?:ing|ed)?|creat(?:e|ing)|cod(?:e|ing)|mak(?:e|ing)|launch(?:ing|ed)?)\b/i;

const noCashCompRegex = /\b(equity only|equity based|for equity|revenue share|rev share|profit share only|no upfront (pay|payment|cash)|unpaid but|percentage of (sales|profit) only)\b/i;

const devShopSubcontractRegex = /\b(our (dev|development|software|tech) (shop|agency|studio)|we('re| are) a (dev|development|software) (shop|agency|studio)|subcontract(or|ing)?\b.{0,40}\b(developer|dev work)|overflow (dev|development|coding) work|white label (dev|development)|need (a )?subcontractor)\b/i;

function extractBudget(text) {
  const m = text.match(/\$[\d,]+(?:k)?(?:\/(?:hr|hour|mo|month))?|\d+(?:\.\d+)?(?:k)?\s*(?:dollars|usd|budget)/i);
  return m ? m[0] : "";
}

function scoreDevHire(post, leadType) {
  let score = 50;
  const text = `${post.title} ${post.selftext || ""}`.toLowerCase();
  if (leadType === "DEV_HIRE_URGENT") score += 30;
  if (leadType === "DEV_HIRE_SUBREDDIT") score += 20;
  if (leadType === "DEV_HIRE_TAGGED") score += 25;
  if (leadType === "DEV_HIRE_REFERRAL") score += 5;
  if (/urgent|asap|immediately|right away|today|tonight|need now/.test(text)) score += 20;
  if (/\$[\d,]+k?|\d+k?\s*(?:usd|dollars|budget)/.test(text)) score += 25;
  if (/bot|automation|scraper|workflow|automate/.test(text)) score += 20;
  if (/website|web app|mobile app|ios|android|app/.test(text)) score += 10;
  if (/paid|paying|budget|fixed fee|flat fee/.test(text)) score += 15;
  if (/startup|agency|business|company|client/.test(text)) score += 10;
  if (hasBusinessContext(text)) score += 30;
  return score;
}

function devHireQualifies(fullText, tagResult) {
  const isReferral = referralRegex.test(fullText);
  if (!devHireIntentRegex.test(fullText) && !isReferral && tagResult !== "PASS") return { pass: false };
  if (devHireExcludeRegex.test(fullText)) return { pass: false };
  if (firstPersonOwnershipRegex.test(fullText)) return { pass: false };
  if (noCashCompRegex.test(fullText)) return { pass: false };
  if (devShopSubcontractRegex.test(fullText)) return { pass: false };
  if (!hasMoneySignal(fullText) && !hasBusinessContext(fullText) && tagResult !== "PASS") return { pass: false };
  return { pass: true, isReferral };
}

// ─── TRADINGBOT ───────────────────────────────────────────────────────────────
const TRADINGBOT_SUBREDDITS = [
  "algotrading", "Daytrading", "FuturesTrading", "Forex", "trading",
  "TradingView", "technicalanalysis", "optionstrading", "thewallstreet",
  "stocks", "options",
];
// Removed: Futures (now private), PropFirmTrading (banned), FXtrading (banned),
// FuturesTrader71 (dead/low-activity as of last check — verify before re-adding).

const TRADINGBOT_QUERIES = [
  "automate my trading strategy", "trading bot developer", "need a trading bot built",
  "hire someone trading bot", "custom trading bot", "want to automate my strategy",
  "profitable strategy automate", "manual strategy automate", "algo trading developer",
  "trading bot for hire", "pay for trading bot", "funded account strategy automate",
  "prop firm strategy bot", "mt5 bot developer", "tradingview bot developer",
  "my strategy automated", "backtested strategy automate", "ninjatrader developer",
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
  if (hasBusinessContext(text)) score += 15;
  return score;
}

function tradingBotQualifies(fullText) {
  if (!tradingBotIntentRegex.test(fullText)) return false;
  if (tradingBotExcludeRegex.test(fullText)) return false;
  if (!hasMoneySignal(fullText) && !hasBusinessContext(fullText)) return false;
  return true;
}

// ─── SHARED POST HANDLER ──────────────────────────────────────────────────────
function evaluateDevHirePost(post, subredditLabel, trigger) {
  const author = post.author?.name;
  const fullText = `${post.title} ${post.selftext || ""}`;
  const tagResult = checkTagFilter(post.title);
  if (tagResult === "REJECT") {
    log("TAG_FILTERED", `u/${author} rejected by tag: ${post.title.slice(0, 60)}`);
    return null;
  }
  const result = devHireQualifies(fullText, tagResult);
  if (!result.pass) return null;

  const isUrgent = /urgent|asap|immediately|right away|need now/i.test(fullText);
  const leadType = tagResult === "PASS" ? "DEV_HIRE_TAGGED"
    : result.isReferral ? "DEV_HIRE_REFERRAL"
    : (isUrgent ? "DEV_HIRE_URGENT" : "DEV_HIRE_SUBREDDIT");
  const budget = extractBudget(fullText);
  const score = scoreDevHire(post, leadType);

  log("LEAD", `[DEVHIRE] u/${author} in ${subredditLabel} | score:${score} | ${post.title.slice(0, 60)}`);

  return {
    time: new Date().toISOString(), username: author,
    title: post.title.slice(0, 150), url: `https://reddit.com${post.permalink}`,
    subreddit: subredditLabel, leadType, product: "DEVHIRE",
    matchedTrigger: trigger, budget, score,
    moneySignal: hasMoneySignal(fullText) ? "YES" : (hasBusinessContext(fullText) ? "CONTEXT_ONLY" : "NO"),
    selftext: (post.selftext || "").slice(0, 500),
  };
}

function evaluateTradingBotPost(post, subredditLabel, trigger) {
  const author = post.author?.name;
  const fullText = `${post.title} ${post.selftext || ""}`;
  const tagResult = checkTagFilter(post.title);
  if (tagResult === "REJECT") {
    log("TAG_FILTERED", `u/${author} rejected by tag: ${post.title.slice(0, 60)}`);
    return null;
  }
  if (!tradingBotQualifies(fullText)) return null;

  const score = scoreTradingBot(post);
  const budget = extractBudget(fullText);

  log("LEAD", `[TRADINGBOT] u/${author} in ${subredditLabel} | score:${score} | ${post.title.slice(0, 60)}`);

  return {
    time: new Date().toISOString(), username: author,
    title: post.title.slice(0, 150), url: `https://reddit.com${post.permalink}`,
    subreddit: subredditLabel, leadType: "TRADING_BOT", product: "TRADINGBOT",
    matchedTrigger: trigger, budget, score,
    moneySignal: hasMoneySignal(fullText) ? "YES" : (hasBusinessContext(fullText) ? "CONTEXT_ONLY" : "NO"),
    selftext: (post.selftext || "").slice(0, 500),
  };
}

// ─── SCRAPE SUBREDDIT ─────────────────────────────────────────────────────────
async function scrapeSubreddit(subredditName, product, contactedUsers) {
  const newLeads = [];
  try {
    const posts = await reddit.getSubreddit(subredditName).getNew({ limit: 50 });

    for (const post of posts) {
      const key = `${post.id}_${product}`;
      if (seenPostKeys.has(key)) continue;
      seenPostKeys.add(key);

      const author = post.author?.name;
      if (!author || author === "[deleted]" || author === "AutoModerator") continue;
      if (contactedUsers.has(author.toLowerCase())) continue;

      const lead = product === "DEVHIRE"
        ? evaluateDevHirePost(post, subredditName, "subreddit_scan")
        : evaluateTradingBotPost(post, subredditName, "subreddit_scan");
      if (lead) newLeads.push(lead);
    }
  } catch (err) {
    log("ERROR", `r/${subredditName} failed: ${err.message}`);
  }
  return newLeads;
}

// ─── GLOBAL SEARCH ────────────────────────────────────────────────────────────
async function globalSearch(query, product, contactedUsers) {
  const newLeads = [];
  try {
    const results = await reddit.search({ query, sort: "new", time: "day", limit: 25 });

    for (const post of results) {
      const key = `${post.id}_${product}`;
      if (seenPostKeys.has(key)) continue;
      seenPostKeys.add(key);

      const author = post.author?.name;
      if (!author || author === "[deleted]" || author === "AutoModerator") continue;
      if (contactedUsers.has(author.toLowerCase())) continue;

      const subredditLabel = post.subreddit?.display_name || "unknown";
      const lead = product === "DEVHIRE"
        ? evaluateDevHirePost(post, subredditLabel, query)
        : evaluateTradingBotPost(post, subredditLabel, query);
      if (lead) newLeads.push(lead);
    }
  } catch (err) {
    log("ERROR", `Search "${query}" failed: ${err.message}`);
  }
  return newLeads;
}

// ─── MAIN SCRAPE CYCLE ────────────────────────────────────────────────────────
async function runScrapeCycle() {
  log("INFO", "Scrape cycle starting...");

  const contactedUsers = loadContactedUsernames();

  const allLeads = [];

  for (const sub of DEVHIRE_SUBREDDITS) {
    const leads = await scrapeSubreddit(sub, "DEVHIRE", contactedUsers);
    allLeads.push(...leads);
    await sleep(3000);
  }
  for (const sub of TRADINGBOT_SUBREDDITS) {
    const leads = await scrapeSubreddit(sub, "TRADINGBOT", contactedUsers);
    allLeads.push(...leads);
    await sleep(3000);
  }
  for (const query of DEVHIRE_QUERIES) {
    const leads = await globalSearch(query, "DEVHIRE", contactedUsers);
    allLeads.push(...leads);
    await sleep(2500);
  }
  for (const query of TRADINGBOT_QUERIES) {
    const leads = await globalSearch(query, "TRADINGBOT", contactedUsers);
    allLeads.push(...leads);
    await sleep(2500);
  }

  if (allLeads.length > 0) {
    await leadsWriter.writeRecords(allLeads);
    log("INFO", `Wrote ${allLeads.length} new leads to CSV.`);
  } else {
    log("INFO", "No new leads this cycle.");
  }

  if (seenPostKeys.size > 20000) {
    log("INFO", `Clearing seenPostKeys (was ${seenPostKeys.size} entries).`);
    seenPostKeys.clear();
  }
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────
(async () => {
  console.log("=".repeat(60));
  console.log("ClientMagnet Scraper — DEVHIRE + TRADINGBOT — regex-only classification");
  console.log("=".repeat(60));

  while (true) {
    await runScrapeCycle();
    log("INFO", `Next scrape in ${SCRAPE_INTERVAL_MS / 60000} minutes.`);
    await sleep(SCRAPE_INTERVAL_MS);
  }
})();
