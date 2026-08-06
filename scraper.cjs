// scraper.cjs — ClientMagnet Lead Scraper
// DEVHIRE + TRADINGBOT only. No lockedIn. No DM sending.
// agency_bot.cjs handles all DM sending.
//
// FIXES IN THIS VERSION:
// - checkTagFilter's PASS result no longer bypasses the intent regex or
//   the money-signal requirement. It previously let ANY [Request]/[Task]/
//   [Hiring]/[Job] tagged post through unconditionally, regardless of
//   content — this is how a Steam key giveaway request ("[Request][Steam]
//   Breath of Fire IV") and a salaried "[Hiring] Sales & Marketing
//   Specialist" post both scored as real dev-hire leads. PASS now only
//   boosts leadType/score, never bypasses the real checks.
// - jobPostingExcludeRegex added: excludes salaried/W2 job listings
//   (full-time, benefits, onsite, etc.) from DEVHIRE — those are
//   employee postings, not freelance client work.
// - volunteerExcludeRegex added: excludes unpaid/volunteer postings
//   ("Looking for a Volunteer Web Developer") — these have real business
//   context but explicitly no money, so the money-signal-or-context gate
//   let them through. Now excluded outright regardless of context.
// - tradingBotIntentRegex's loose "strategy/system near automate/bot"
//   branch was matching completely unrelated business posts (a window
//   cleaning scaling post, an HR/org performance post, a festival
//   giveaway). hasTradingContext() added as a hard requirement — the
//   post must contain an actual trading-specific word (a market,
//   platform, or trading term) somewhere in the text, not just generic
//   automation language.
// - Reach expanded: added subreddits and search queries currently
//   uncovered, and widened global search window from "day" to "week"
//   (per-product seenPostKeys dedup already prevents reprocessing, so
//   this only adds coverage).

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

const seenPostKeys = new Set();

function loadContactedUsernames() {
  if (!fs.existsSync(usersPath)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(usersPath, "utf8"));
    return new Set(Object.keys(data));
  } catch { return new Set(); }
}

// ─── TAG FILTER ────────────────────────────────────────────────────────────────
// REJECT is still a hard exclude (these are people OFFERING services, not
// buyers). PASS is now advisory only — it labels leadType and boosts score,
// it does NOT bypass the intent or money-signal checks below.
function checkTagFilter(title) {
  const t = (title || "").toLowerCase();
  if (/\[for ?hire\]|\[offer\]|\[services\]|\[available\]|\[freelancer\]/i.test(t)) return "REJECT";
  if (/\[task\]|\[hiring\]|\[request\]|\[job\]/i.test(t)) return "ADVISORY_PASS";
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

// ─── JOB POSTING EXCLUDE (salaried/W2 employee listings, not freelance work) ───
const jobPostingExcludeRegex = /\b(full-time|full time|part-time|part time|\bW2\b|salary|onsite|in-office|benefits package|401k|paid time off|\bPTO\b|equity \+ salary|equity plus salary|health insurance|relocation)\b/i;

// ─── VOLUNTEER / UNPAID EXCLUDE ────────────────────────────────────────────────
// Real business context but explicitly no money — the context-only gate
// let these through before. "Looking for a Volunteer Web Developer" is
// the case that surfaced this.
const volunteerExcludeRegex = /\b(volunteer|unpaid position|non-?paid|pro bono|for exposure|for experience only|internship \(unpaid\))\b/i;

// ─── DEVHIRE ──────────────────────────────────────────────────────────────────
const DEVHIRE_SUBREDDITS = [
  "forhire", "hiring", "entrepreneur", "smallbusiness", "startups",
  "SideProject", "webdev", "shopify", "ecommerce", "passive_income",
  "Flipping", "socialmedia", "digital_marketing",
  // added for reach
  "WebDevJobs", "SaaS", "nocode", "Zapier", "juststart", "growmybusiness",
];

const DEVHIRE_QUERIES = [
  "need a developer", "need a programmer", "need someone to build",
  "looking for developer", "hire a developer", "hire a programmer",
  "need a bot built", "need automation built", "need a website built",
  "need a web app built", "need an app built", "need a mobile app built",
  "can someone build a bot", "willing to pay developer", "budget for developer",
  "need someone to code", "need a scraper built", "need automation help",
  "looking for coder", "need a custom tool built", "does anyone know a good developer",
  // added for reach
  "need this done this week", "budget is flexible", "serious inquiries only",
  "looking to hire freelance developer", "need help automating my business",
  "want to pay someone to build",
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

// tagResult "ADVISORY_PASS" now only feeds leadType/score below — it is
// NEVER allowed to skip the intent check or the money-signal check.
function devHireQualifies(fullText, tagResult) {
  const isReferral = referralRegex.test(fullText);
  const hasRealIntent = devHireIntentRegex.test(fullText) || isReferral;
  if (!hasRealIntent) return { pass: false };
  if (devHireExcludeRegex.test(fullText)) return { pass: false };
  if (firstPersonOwnershipRegex.test(fullText)) return { pass: false };
  if (noCashCompRegex.test(fullText)) return { pass: false };
  if (devShopSubcontractRegex.test(fullText)) return { pass: false };
  if (jobPostingExcludeRegex.test(fullText)) return { pass: false };
  if (volunteerExcludeRegex.test(fullText)) return { pass: false };
  if (!hasMoneySignal(fullText) && !hasBusinessContext(fullText)) return { pass: false };
  return { pass: true, isReferral };
}

// ─── TRADINGBOT ───────────────────────────────────────────────────────────────
const TRADINGBOT_SUBREDDITS = [
  "algotrading", "Daytrading", "FuturesTrading", "Forex", "trading",
  "TradingView", "technicalanalysis", "optionstrading", "thewallstreet",
  "stocks", "options",
  // added for reach
  "quant", "CryptoMarkets", "FundedTrading", "PropFirms",
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
  // added for reach
  "need help automating trades", "pay someone to build trading bot",
  "looking for algo developer", "budget for trading bot",
];

const tradingBotIntentRegex = /\b(automat|bot|algo|algorithm)\b.{0,80}\b(strateg|trade|trading|entry|exit|signal|execution)\b|\b(strateg|setup|system|signal)\b.{0,80}\b(automat|bot|algo|running|execut|passive)\b|\b(profitable|proven|backtested|live|working|manual|tested)\b.{0,60}\b(strateg|system|setup|signal|trade|results)\b|\b(hire|pay|budget|looking for|need someone|need a dev|custom|developer)\b.{0,60}\b(bot|algo|trading bot|automat|script|strategy)\b|\b(funded account|prop firm|topstep|apex|FTMO|combine|passed combine|live account)\b/i;

const tradingBotExcludeRegex = /\b(beginner|just started|new to trading|learning to trade|paper trading only|no money|broke|can't afford|free bot|open source|free strategy|copy trading|signals|i built|i've built|already built|already have|already made|working on building|been working on|launched this week|launched recently)\b/i;

// Hard requirement: the post must actually be about trading/markets
// somewhere in the text, not just generic "strategy/system/automate"
// business language. This is what was letting a window cleaning post
// and an HR/org performance post through.
const tradingContextRegex = /\b(trad(e|ing)|forex|futures|crypto(currency)?|stocks?|options?|nq|es|gc|gold|eurusd|gbpusd|forex pair|broker|exchange|mt4|mt5|tradingview|ninjatrader|thinkorswim|interactive brokers|ibkr|topstep|ftmo|apex|prop firm|pips?|leverage|long position|short position|candlestick|chart pattern|backtest|drawdown|win rate)\b/i;

function hasTradingContext(text) {
  return tradingContextRegex.test(text);
}

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
  if (!hasTradingContext(fullText)) return false;
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
  const leadType = tagResult === "ADVISORY_PASS" ? "DEV_HIRE_TAGGED"
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
    const results = await reddit.search({ query, sort: "new", time: "week", limit: 25 });

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
