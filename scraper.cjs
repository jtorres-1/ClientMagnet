// scraper.cjs — ClientMagnet Lead Scraper
// DEVHIRE + TRADINGBOT only. No lockedIn. No DM sending.
// agency_bot.cjs handles all DM sending.
// LLM classification layer added — calls local Ollama (via ngrok tunnel to Mac)
// Falls back to regex-only if LLM is unreachable, so scraper never breaks.
//
// CHANGES IN THIS VERSION:
// - Tag filter for [Task]/[ForHire] style prefixes, rejects before any other check runs
// - Expanded exclude regex to catch more self-promo phrasing
// - hasMoneySignal() as a separate hard requirement, not just a scoring bonus
// - Business context scoring boost for posts describing an existing operation
// - LLM prompt now returns VERDICT + MONEY_SIGNAL instead of just HIRE/REJECT

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

// ─── LLM CLASSIFICATION CONFIG ────────────────────────────────────────────────
const OLLAMA_URL = process.env.OLLAMA_URL || "https://25ee-2603-8000-c93f-49c1-100c-19e8-6d5-9461.ngrok-free.app";
const OLLAMA_MODEL = "qwen2.5:14b";
const LLM_TIMEOUT_MS = 20000;

let llmAvailable = true;
let consecutiveLLMFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;

// ─── TAG FILTER ────────────────────────────────────────────────────────────────
// r/forhire, r/hiring, similar subs use explicit title prefixes.
// [ForHire]/[Offer]/[Services]/[Available] = someone offering their own skills, reject immediately.
// [Task]/[Hiring]/[Request]/[Job] = someone with a job to give, real signal.
function checkTagFilter(title) {
  const t = (title || "").toLowerCase();
  if (/\[for ?hire\]|\[offer\]|\[services\]|\[available\]|\[freelancer\]/i.test(t)) return "REJECT";
  if (/\[task\]|\[hiring\]|\[request\]|\[job\]/i.test(t)) return "PASS";
  return "NEUTRAL";
}

// ─── MONEY SIGNAL ──────────────────────────────────────────────────────────────
// Hard requirement, not a scoring bonus. If this doesn't hit, the lead
// doesn't go to the DM queue no matter how well it matches intent.
function hasMoneySignal(text) {
  return /\$[\d,]+k?|\d+k?\s*(?:usd|dollars)|budget of|paying \$|willing to pay|flat fee|our budget|client budget|\d+\/hr|\d+\/hour|compensation|paid position|paid project|paid work/i.test(text);
}

// ─── BUSINESS CONTEXT ──────────────────────────────────────────────────────────
// Posts describing an existing operation (not just an idea) are more likely
// to actually have money behind them.
function hasBusinessContext(text) {
  return /\bour (store|company|team|clients|business|shop|agency)\b|\bwe (have|do|run|sell|operate)\b|\d+\s*employees|monthly revenue|our revenue|our customers|existing (business|store|shop|clients)/i.test(text);
}

async function classifyWithLLM(fullText, product) {
  if (!llmAvailable) return { ok: false, verdict: null, moneySignal: null, reason: "llm_disabled_this_cycle" };

  const prompt = product === "TRADINGBOT"
    ? `You are screening Reddit posts to find people who want to HIRE someone to build/automate a trading bot for them, and who can actually pay for it.

REJECT if the author: already built their own bot/strategy, is offering their own dev/trading services, is a total beginner with no capital, or is just asking general questions with no hiring intent.

Post: "${fullText.slice(0, 500)}"

Reply in this exact format, nothing else:
VERDICT: HIRE or REJECT
MONEY_SIGNAL: YES or NO`
    : `You are screening Reddit posts to find people who want to HIRE a developer to build something for them, and who can actually pay for it.

REJECT if the author: is describing something they already built, is offering their own dev services for hire, or shows no real budget or business context.

Post: "${fullText.slice(0, 500)}"

Reply in this exact format, nothing else:
VERDICT: HIRE or REJECT
MONEY_SIGNAL: YES or NO`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.1, num_predict: 20 }
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    consecutiveLLMFailures = 0;

    if (!res.ok) return { ok: false, verdict: null, moneySignal: null, reason: `HTTP ${res.status}` };

    const data = await res.json();
    const raw = (data.response || "").trim().toUpperCase();

    const verdict = raw.includes("VERDICT: HIRE") || (raw.includes("HIRE") && !raw.includes("REJECT")) ? "HIRE" : "REJECT";
    const moneySignal = raw.includes("MONEY_SIGNAL: YES") || raw.includes("MONEY_SIGNAL:YES") ? "YES" : "NO";

    return { ok: true, verdict, moneySignal };

  } catch (err) {
    consecutiveLLMFailures++;
    if (consecutiveLLMFailures >= MAX_CONSECUTIVE_FAILURES) {
      llmAvailable = false;
      log("WARN", `LLM failed ${MAX_CONSECUTIVE_FAILURES}x in a row (Mac likely offline) — disabling LLM checks for this cycle, using regex only`);
    }
    return { ok: false, verdict: null, moneySignal: null, reason: err.message };
  }
}

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
    { id: "llmVerdict",     title: "LLM Verdict" },
    { id: "moneySignal",    title: "Money Signal" },
    { id: "selftext",       title: "Selftext" },
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
  "looking for coder", "need a custom tool built",
];

const devHireIntentRegex = /\b(need|want|looking for|hiring|hire|searching for|seeking|require|paid|paying|budget|willing to pay)\b.{0,60}\b(developer|programmer|coder|dev|engineer|builder|freelancer)\b|\b(build|create|make|develop|code|automate|scrape)\b.{0,60}\b(bot|automation|script|tool|app|website|web app|mobile app|dashboard|platform|scraper|integration|workflow|saas)\b|\[H\].{0,100}(developer|programmer|dev|build|app|bot|website)/i;

const devHireExcludeRegex = /\b(i am a|i'm a|i am an|offering|available for hire|available to help|i can build|i build|i develop|i code|my services|my portfolio|hire me|dm me|contact me|i will build|i'll build|i built|i've built|i have built|i am building|i'm building|i am developing|i've developed|already built|already have|already made|working on building|been building|been working on|launched this week|launched recently|check out my|i specialize|looking for work|looking for clients|for hire|freelancer here|open to work|reach out|my rates|\$\d+\/hr|\$\d+\/hour|years of experience|check my profile|check out my profile|dm me for rates|open to opportunities|available for freelance|available for contract|portfolio:|my github|full stack developer here|backend developer here|frontend developer here|senior developer here|available immediately)\b/i;

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
  if (/urgent|asap|immediately|right away|today|tonight|need now/.test(text)) score += 20;
  if (/\$[\d,]+k?|\d+k?\s*(?:usd|dollars|budget)/.test(text)) score += 25;
  if (/bot|automation|scraper|workflow|automate/.test(text)) score += 20;
  if (/website|web app|mobile app|ios|android|app/.test(text)) score += 10;
  if (/paid|paying|budget|fixed fee|flat fee/.test(text)) score += 15;
  if (/startup|agency|business|company|client/.test(text)) score += 10;
  if (hasBusinessContext(text)) score += 30;
  return score;
}

// ─── TRADINGBOT ───────────────────────────────────────────────────────────────
const TRADINGBOT_SUBREDDITS = [
  "algotrading", "Daytrading", "FuturesTrading", "Forex", "trading",
  "TradingView", "technicalanalysis", "Futures", "PropFirmTrading",
  "stocks", "options", "FuturesTrader71", "FXtrading",
];

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

      // Tag filter runs first, before any other check
      const tagResult = checkTagFilter(post.title);
      if (tagResult === "REJECT") {
        log("TAG_FILTERED", `u/${author} rejected by tag: ${post.title.slice(0, 60)}`);
        continue;
      }

      if (product === "DEVHIRE") {
        if (!devHireIntentRegex.test(fullText) && tagResult !== "PASS") continue;
        if (devHireExcludeRegex.test(fullText)) continue;
        if (!hasMoneySignal(fullText) && !hasBusinessContext(fullText) && tagResult !== "PASS") {
          log("SKIP_NO_MONEY", `[DEVHIRE] u/${author}: ${post.title.slice(0, 60)}`);
          continue;
        }

        const llmResult = await classifyWithLLM(fullText, "DEVHIRE");
        if (llmResult.ok && llmResult.verdict === "REJECT") {
          log("LLM_FILTERED", `[DEVHIRE] u/${author} rejected by LLM: ${post.title.slice(0, 60)}`);
          continue;
        }
        if (llmResult.ok && llmResult.moneySignal === "NO" && !hasMoneySignal(fullText)) {
          log("LLM_NO_MONEY", `[DEVHIRE] u/${author} no money signal per LLM: ${post.title.slice(0, 60)}`);
          continue;
        }

        const isUrgent = /urgent|asap|immediately|right away|need now/i.test(fullText);
        const leadType = tagResult === "PASS" ? "DEV_HIRE_TAGGED" : (isUrgent ? "DEV_HIRE_URGENT" : "DEV_HIRE_SUBREDDIT");
        const budget = extractBudget(fullText);
        const score = scoreDevHire(post, leadType);
        newLeads.push({
          time: new Date().toISOString(), username: author,
          title: post.title.slice(0, 150), url: `https://reddit.com${post.permalink}`,
          subreddit: subredditName, leadType, product: "DEVHIRE",
          matchedTrigger: "subreddit_scan", budget, score,
          llmVerdict: llmResult.ok ? llmResult.verdict : "N/A (llm unavailable)",
          moneySignal: llmResult.ok ? llmResult.moneySignal : (hasMoneySignal(fullText) ? "YES" : "UNKNOWN"),
          selftext: (post.selftext || "").slice(0, 500),
        });
        log("LEAD", `[DEVHIRE] u/${author} in r/${subredditName} | score:${score} | llm:${llmResult.ok ? llmResult.verdict : "skipped"} | ${post.title.slice(0, 60)}`);
      }

      if (product === "TRADINGBOT") {
        if (!tradingBotIntentRegex.test(fullText)) continue;
        if (tradingBotExcludeRegex.test(fullText)) continue;
        if (!hasMoneySignal(fullText) && !hasBusinessContext(fullText)) {
          log("SKIP_NO_MONEY", `[TRADINGBOT] u/${author}: ${post.title.slice(0, 60)}`);
          continue;
        }

        const llmResult = await classifyWithLLM(fullText, "TRADINGBOT");
        if (llmResult.ok && llmResult.verdict === "REJECT") {
          log("LLM_FILTERED", `[TRADINGBOT] u/${author} rejected by LLM: ${post.title.slice(0, 60)}`);
          continue;
        }
        if (llmResult.ok && llmResult.moneySignal === "NO" && !hasMoneySignal(fullText)) {
          log("LLM_NO_MONEY", `[TRADINGBOT] u/${author} no money signal per LLM: ${post.title.slice(0, 60)}`);
          continue;
        }

        const score = scoreTradingBot(post);
        const budget = extractBudget(fullText);
        newLeads.push({
          time: new Date().toISOString(), username: author,
          title: post.title.slice(0, 150), url: `https://reddit.com${post.permalink}`,
          subreddit: subredditName, leadType: "TRADING_BOT", product: "TRADINGBOT",
          matchedTrigger: "subreddit_scan", budget, score,
          llmVerdict: llmResult.ok ? llmResult.verdict : "N/A (llm unavailable)",
          moneySignal: llmResult.ok ? llmResult.moneySignal : (hasMoneySignal(fullText) ? "YES" : "UNKNOWN"),
          selftext: (post.selftext || "").slice(0, 500),
        });
        log("LEAD", `[TRADINGBOT] u/${author} in r/${subredditName} | score:${score} | llm:${llmResult.ok ? llmResult.verdict : "skipped"} | ${post.title.slice(0, 60)}`);
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

      const tagResult = checkTagFilter(post.title);
      if (tagResult === "REJECT") {
        log("TAG_FILTERED", `[GLOBAL] u/${author} rejected by tag: ${post.title.slice(0, 60)}`);
        continue;
      }

      if (product === "DEVHIRE") {
        if (!devHireIntentRegex.test(fullText) && tagResult !== "PASS") continue;
        if (devHireExcludeRegex.test(fullText)) continue;
        if (!hasMoneySignal(fullText) && !hasBusinessContext(fullText) && tagResult !== "PASS") {
          log("SKIP_NO_MONEY", `[DEVHIRE/GLOBAL] u/${author}: ${post.title.slice(0, 60)}`);
          continue;
        }

        const llmResult = await classifyWithLLM(fullText, "DEVHIRE");
        if (llmResult.ok && llmResult.verdict === "REJECT") {
          log("LLM_FILTERED", `[DEVHIRE/GLOBAL] u/${author} rejected by LLM: ${post.title.slice(0, 60)}`);
          continue;
        }
        if (llmResult.ok && llmResult.moneySignal === "NO" && !hasMoneySignal(fullText)) {
          log("LLM_NO_MONEY", `[DEVHIRE/GLOBAL] u/${author} no money signal: ${post.title.slice(0, 60)}`);
          continue;
        }

        const isUrgent = /urgent|asap|immediately|right away|need now/i.test(fullText);
        const leadType = tagResult === "PASS" ? "DEV_HIRE_TAGGED" : (isUrgent ? "DEV_HIRE_URGENT" : "DEV_HIRE_GLOBAL");
        const budget = extractBudget(fullText);
        const score = scoreDevHire(post, leadType);
        newLeads.push({
          time: new Date().toISOString(), username: author,
          title: post.title.slice(0, 150), url: `https://reddit.com${post.permalink}`,
          subreddit: post.subreddit?.display_name || "unknown",
          leadType, product: "DEVHIRE", matchedTrigger: query, budget, score,
          llmVerdict: llmResult.ok ? llmResult.verdict : "N/A (llm unavailable)",
          moneySignal: llmResult.ok ? llmResult.moneySignal : (hasMoneySignal(fullText) ? "YES" : "UNKNOWN"),
          selftext: (post.selftext || "").slice(0, 500),
        });
        log("LEAD", `[DEVHIRE/GLOBAL] u/${author} | "${query}" | score:${score} | llm:${llmResult.ok ? llmResult.verdict : "skipped"}`);
      }

      if (product === "TRADINGBOT") {
        if (!tradingBotIntentRegex.test(fullText)) continue;
        if (tradingBotExcludeRegex.test(fullText)) continue;
        if (!hasMoneySignal(fullText) && !hasBusinessContext(fullText)) {
          log("SKIP_NO_MONEY", `[TRADINGBOT/GLOBAL] u/${author}: ${post.title.slice(0, 60)}`);
          continue;
        }

        const llmResult = await classifyWithLLM(fullText, "TRADINGBOT");
        if (llmResult.ok && llmResult.verdict === "REJECT") {
          log("LLM_FILTERED", `[TRADINGBOT/GLOBAL] u/${author} rejected by LLM: ${post.title.slice(0, 60)}`);
          continue;
        }
        if (llmResult.ok && llmResult.moneySignal === "NO" && !hasMoneySignal(fullText)) {
          log("LLM_NO_MONEY", `[TRADINGBOT/GLOBAL] u/${author} no money signal: ${post.title.slice(0, 60)}`);
          continue;
        }

        const score = scoreTradingBot(post);
        const budget = extractBudget(fullText);
        newLeads.push({
          time: new Date().toISOString(), username: author,
          title: post.title.slice(0, 150), url: `https://reddit.com${post.permalink}`,
          subreddit: post.subreddit?.display_name || "unknown",
          leadType: "TRADING_BOT", product: "TRADINGBOT", matchedTrigger: query, budget, score,
          llmVerdict: llmResult.ok ? llmResult.verdict : "N/A (llm unavailable)",
          moneySignal: llmResult.ok ? llmResult.moneySignal : (hasMoneySignal(fullText) ? "YES" : "UNKNOWN"),
          selftext: (post.selftext || "").slice(0, 500),
        });
        log("LEAD", `[TRADINGBOT/GLOBAL] u/${author} | "${query}" | score:${score} | llm:${llmResult.ok ? llmResult.verdict : "skipped"}`);
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

  llmAvailable = true;
  consecutiveLLMFailures = 0;

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

  if (!llmAvailable) {
    log("WARN", "LLM was unavailable during this cycle — leads were filtered by regex only.");
  }
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────
(async () => {
  console.log("=".repeat(60));
  console.log("ClientMagnet Scraper — DEVHIRE + TRADINGBOT + LLM classification + money filter");
  console.log("=".repeat(60));

  while (true) {
    await runScrapeCycle();
    log("INFO", `Next scrape in ${SCRAPE_INTERVAL_MS / 60000} minutes.`);
    await sleep(SCRAPE_INTERVAL_MS);
  }
})();
