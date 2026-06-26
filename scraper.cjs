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
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir);
const leadsPath = path.join(baseDir, "clean_leads.csv");
const HEADER = "username,title,url,subreddit,time,leadType,matchedTrigger,product,budget,score";
if (!fs.existsSync(leadsPath)) fs.writeFileSync(leadsPath, HEADER + "\n");

function prependLead(file, rowObj) {
  const row = Object.values(rowObj).map(v => `${v}`).join(",") + "\n";
  const lines = fs.readFileSync(file, "utf8").split("\n");
  if (!lines[0].startsWith("username")) lines.unshift(HEADER);
  lines.splice(1, 0, row.trim());
  fs.writeFileSync(file, lines.join("\n"));
}

// ─── DEVHIRE SUBREDDITS ───────────────────────────────────────────────────────
const DEVHIRE_SUBREDDITS = [
  "forhire",
  "slavelabour",
  "freelance_forhire",
  "freelancer_hire",
  "freelanceprogramming",
  "DoneDirtCheap",
  "learnmachinelearning",
  "hwstartups",
  "EntrepreneurRideAlong",
  "SomebodyMakeThis",
  "startups",
  "JobsForGeeks",
  "WorkOnline",
  "jobs4bitcoins",
      "Entrepreneur",
  "smallbusiness",
  "agency",
  "digital_marketing",
  "ecommerce",
];

// ─── TRADING BOT SUBREDDITS ───────────────────────────────────────────────────
const TRADINGBOT_SUBREDDITS = [
  "algotrading",
  "Daytrading",
  "Forex",
    "CryptoMarkets",
  "trading",
  "StockMarket",
  "options",
  ];

// ─── LOCKEDIN QUERIES ─────────────────────────────────────────────────────────
const LOCKEDIN_QUERIES = [
  "I waste so much time figuring out what to do first",
  "I can't stick to a schedule",
  "I have too many tasks and don't know where to start",
  "I spend my whole morning planning and never get anything done",
  "I'm so unproductive I don't know why",
  "I struggle to manage my time",
  "I can't get anything done during the day",
  "how do I stop wasting my mornings",
  "I have no structure to my day",
  "I need help organizing my day",
  "I feel overwhelmed with everything I need to do",
  "I can never finish my to do list",
  "my days feel chaotic and unproductive",
  "I need to be more productive but don't know how",
  "I procrastinate all day and get nothing done",
  "I have ADHD and can't organize my tasks",
  "I struggle with time blocking",
  "I can never follow through with my schedule",
  "I need a better morning routine",
  "how to actually be productive",
  "I set goals but never follow through",
  "I feel like I'm always busy but getting nothing done",
  "I need to plan my day better",
  "how to stop wasting time every morning",
  "I lose hours just deciding what to work on",
];

// ─── TRADING BOT QUERIES ──────────────────────────────────────────────────────
const TRADINGBOT_QUERIES = [
  "trading bot developer",
  "automate trading strategy",
  "algo trading hire",
  "trading bot python",
  "TradingView automation",
  "automated trading strategy",
  "forex bot developer",
  "crypto trading bot hire",
  "trading bot for hire",
  "hire algo trader",
  "trading automation developer",
  "automate my strategy",
  "trading script developer",
  "futures trading bot",
  "forex trading automation",
  "crypto bot developer",
  "trading bot commission",
  "algorithmic trading developer",
  "pine script automation",
  "trading webhook automation",
];

// ─── BLOCK FILTERS ────────────────────────────────────────────────────────────
const offeringTagRegex = /^\s*\[(for hire|FH|FOR HIRE|offering|OFFERING|available|AVAILABLE|forhire)\]/i;

const offeringContentRegex = /\b(i am available for hire|hire me|my rates start|check out my portfolio|looking for clients|open to new clients|taking on new clients|accepting new clients|available for freelance work|i offer (my )?services|my services include|feel free to dm me for (rates|pricing|work)|years of experience (in|with)|i specialize in building|i have \d+ years|portfolio link|my github|view my work)\b/i;

const blockRegex = /\b(looking for a job|job hunting|resume|cover letter|applying for|interview prep|laid off|unemployment|homework|assignment|school project|research paper|how do i become|how to become|learning to code|trying to learn|beginner developer|new to programming|studying programming)\b/i;

// ─── HIRING TAG DETECTION ─────────────────────────────────────────────────────
const hiringTagRegex = /^\s*\[(h|hiring|hire|paid|budget|job|project|HIRING|HIRE|H|PAID|BUDGET|JOB|PROJECT)\]/i;

const hiringKeywordRegex = /\b(looking to hire (a |an )?(developer|programmer|coder|dev|engineer|freelancer)|want to hire (a |an )?(developer|programmer|coder|dev)|need to hire (a |an )?(developer|programmer|coder|dev)|hiring a developer|hiring an engineer|need a developer|need a programmer|need a coder|need a dev|need someone to (build|create|code|fix|scrape|automate|develop)|looking for a (developer|programmer|coder|dev|freelancer) (to|who|that)|my budget is \$|budget is \$|willing to pay \$|will pay \$|paid (project|gig|work)|need (a bot|a script|a scraper|a tool|a website|an app|a dashboard|an api|a saas|automation) (built|created|developed|made)|can (anyone|someone) build|who can build|anyone able to build|need help (building|creating|coding|developing) (a |an |my )?)\b/i;

// ─── TRADING BOT INTENT ───────────────────────────────────────────────────────
const tradingBotIntentRegex = /\b(automate (my |a |the )?(trading|strategy|trades|signals|entries|exits|orders)|trading bot|algo(rithm)?( trading)?( bot| system| strategy)?|need (a |someone to build )?(bot|script|automation) (for|to) (trade|trading|execute|forex|futures|crypto|stocks)|execute (trades|orders) automatically|TradingView (alert|signal|webhook) automation|pine script to (live|real|automated) trading|manual(ly)? execut|too slow to (enter|exit|trade) manually|missing (entries|trades|signals)|backtest(ed|ing)? (my |a )?strategy|strategy (that |I )?(need|want) automated|want to (go live|automate|run) (my |a )?strategy|hiring (a |an )?algo|looking for (a |an )?(algo|quant|bot) developer)\b/i;

const tradingBuyerRegex = /\b(looking for (a |an )?(developer|dev|coder|programmer|someone)|need (a |an )?(developer|dev|coder|programmer|someone to)|hire|hiring|paid|budget|will pay|how much would|commission|build me|build for me|can someone|anyone able|who can|is there (a |an )?service|does anyone (know|offer)|recommend (a |an )?developer)\b/i;

const tradingBlockRegex = /\b(just sharing|my results|my pnl|how i trade|my approach|what do you think|rate my|review my|is this strategy good|advice on my|feedback on|am i doing this right|paper trading journey|learning to trade|new to trading|trading journal|day \d+ of|week \d+ of)\b/i;

// ─── BUDGET DETECTION ─────────────────────────────────────────────────────────
const budgetRegex = /\$\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(k|K)?|\b(\d+(?:,\d{3})*)\s*(dollars?|usd|budget)\b/i;
const urgencyRegex = /\b(urgent|urgently|asap|as soon as possible|today|immediately|right away|need it done fast|need it now|rush|quickly|by tomorrow|by end of day|eod)\b/i;

// ─── LOCKEDIN INTENT ──────────────────────────────────────────────────────────
const lockedInIntentRegex = /\b(waste (time|my morning|hours)|wasting (time|mornings)|can't (stick to|follow|organize|manage|get anything done|finish)|struggling (to|with) (manage|organize|plan|schedule|focus|time|productivity)|overwhelmed (with|by) (tasks|everything|to do)|no structure|chaotic day|unproductive|procrastinat|don't know where to start|too many tasks|can never finish|lose(s)? hours|morning routine|time blocking|plan my day|organize my day|better schedule|stop wasting|ADHD and (can't|struggle|unable)|nothing done|always busy but|getting nothing done)\b/i;

const firstPersonBuyerRegex = /\b(i need help (with|organizing|managing|planning)|i need someone to|i'm looking for (a tool|an app|something that)|i am looking for (a tool|an app|something that)|i need to (fix|solve|stop) (my|this)|i can never|i struggle (to|with)|i keep (failing|losing|missing|forgetting)|i have (tried|been trying)|i can't seem to|i don't know how to stop|i've been trying to)\b/i;

// ─── FRESHNESS ────────────────────────────────────────────────────────────────
function isFresh(post, maxHours = 6) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= maxHours;
}

// ─── ACCOUNT QUALITY ─────────────────────────────────────────────────────────
function isQualityAccount(post) {
  const name = (post.author?.name || "").toLowerCase();
  if (name === "automoderator" || name.includes("bot") || name.includes("mod")) return false;
  return true;
}

// ─── BUDGET EXTRACTION ────────────────────────────────────────────────────────
function extractBudget(text) {
  const match = text.match(budgetRegex);
  if (!match) return null;
  return match[0].trim().slice(0, 20);
}

// ─── HIRING POST CHECK ────────────────────────────────────────────────────────
function isHiringPost(post) {
  const title = (post.title || "");
  const body = (post.selftext || "");
  const combined = `${title} ${body}`;

  if (offeringTagRegex.test(title)) return false;
  if (offeringContentRegex.test(combined)) return false;
  if (blockRegex.test(combined)) return false;

  const hasHiringTag = hiringTagRegex.test(title);
  const hasKeywords = hiringKeywordRegex.test(combined);

  return hasHiringTag || hasKeywords;
}

// ─── LOCKEDIN POST CHECK ──────────────────────────────────────────────────────
function isLockedInLead(post) {
  const title = (post.title || "").toLowerCase();
  const body = (post.selftext || "").toLowerCase();
  const combined = `${title} ${body}`;

  if (title.length < 10) return false;
  if (offeringTagRegex.test(title)) return false;
  if (offeringContentRegex.test(combined)) return false;
  if (blockRegex.test(combined)) return false;
  if (!lockedInIntentRegex.test(combined)) return false;
  if (!firstPersonBuyerRegex.test(combined)) return false;

  return true;
}

// ─── TRADING BOT POST CHECK ───────────────────────────────────────────────────
function isTradingBotLead(post) {
  const title = (post.title || "");
  const body = (post.selftext || "");
  const combined = `${title} ${body}`;

  if (offeringTagRegex.test(title)) return false;
  if (offeringContentRegex.test(combined)) return false;
  if (tradingBlockRegex.test(combined)) return false;
  const hasIntent = tradingBotIntentRegex.test(combined);
  const hasBuyer = tradingBuyerRegex.test(combined);
  if (!hasIntent && !hasBuyer) return false;

  return true;
}

// ─── LEAD SCORING ─────────────────────────────────────────────────────────────
function scoreDevHireLead(post) {
  let score = 40;
  const combined = `${post.title} ${post.selftext || ""}`.toLowerCase();

  if (budgetRegex.test(combined)) score += 20;
  if (urgencyRegex.test(combined)) score += 15;
  if (/bot|scraper|automation|automate|script|api|saas|dashboard|web app/.test(combined)) score += 10;
  if (/\$[5-9]\d{2}|\$[1-9]\d{3}/.test(combined)) score += 15;
  if (/python|node|playwright|puppeteer|selenium|ai|openai|gpt/.test(combined)) score += 8;

  return score;
}

function scoreTradingBotLead(post) {
  let score = 50;
  const combined = `${post.title} ${post.selftext || ""}`.toLowerCase();

  if (budgetRegex.test(combined)) score += 25;
  if (urgencyRegex.test(combined)) score += 15;
  if (/\$[5-9]\d{2}|\$[1-9]\d{3}|\$[1-9]\d{4}/.test(combined)) score += 20;
  if (/kraken|coinbase|interactive brokers|tradovate|topstep|funded/.test(combined)) score += 10;
  if (/futures|forex|crypto|options|stocks/.test(combined)) score += 8;
  if (/live trading|real money|funded account|prop (firm|trading)/.test(combined)) score += 12;

  return score;
}

const wait = ms => new Promise(res => setTimeout(res, ms));

// ─── SCRAPE DEVHIRE SUBREDDITS ────────────────────────────────────────────────
async function scrapeDevHireSubreddits() {
  const existingUrls = new Set(
    fs.readFileSync(leadsPath, "utf8").split("\n").map(l => l.split(",")[2])
  );
  let leads = 0;

  for (const sub of DEVHIRE_SUBREDDITS) {
    console.log(`Scraping r/${sub} for hiring posts...`);
    try {
      await wait(2000);
      const posts = await reddit.getSubreddit(sub).getNew({ limit: 100 });
      for (const p of posts) {
        if (!p.author) continue;
        if (!isFresh(p, 6)) continue;
        if (!isHiringPost(p)) continue;
        if (!isQualityAccount(p)) continue;

        const url = `https://reddit.com${p.permalink}`;
        if (existingUrls.has(url)) continue;

        const combined = `${p.title} ${p.selftext || ""}`;
        const budget = extractBudget(combined) || "";
        const score = scoreDevHireLead(p);
        const isUrgent = urgencyRegex.test(combined);

        const row = {
          username: p.author.name,
          title: `"${p.title.replace(/"/g, "'").replace(/,/g, " ")}"`,
          url,
          subreddit: `r/${sub}`,
          time: new Date(p.created_utc * 1000).toISOString(),
          leadType: isUrgent ? "DEV_HIRE_URGENT" : "DEV_HIRE_SUBREDDIT",
          matchedTrigger: p.title.slice(0, 60).replace(/,/g, " "),
          product: "DEVHIRE",
          budget,
          score
        };
        prependLead(leadsPath, row);
        existingUrls.add(url);
        leads++;
        console.log(`  + ${row.leadType} [r/${sub}] score:${score} budget:${budget||"unknown"}: u/${p.author.name} - "${p.title.slice(0, 50)}"`);
      }
    } catch (err) {
      console.log(`Error scraping r/${sub}: ${err.message}`);
      await wait(10000);
    }
  }
  return leads;
}

// ─── SCRAPE TRADING BOT SUBREDDITS ───────────────────────────────────────────
async function scrapeTradingBotSubreddits() {
  const existingUrls = new Set(
    fs.readFileSync(leadsPath, "utf8").split("\n").map(l => l.split(",")[2])
  );
  let leads = 0;

  for (const sub of TRADINGBOT_SUBREDDITS) {
    console.log(`Scraping r/${sub} for trading bot leads...`);
    try {
      await wait(2000);
      const posts = await reddit.getSubreddit(sub).getNew({ limit: 100 });
      for (const p of posts) {
        if (!p.author) continue;
        if (!isFresh(p, 12)) continue;
        if (!isTradingBotLead(p)) continue;
        if (!isQualityAccount(p)) continue;

        const url = `https://reddit.com${p.permalink}`;
        if (existingUrls.has(url)) continue;

        const combined = `${p.title} ${p.selftext || ""}`;
        const budget = extractBudget(combined) || "";
        const score = scoreTradingBotLead(p);

        const row = {
          username: p.author.name,
          title: `"${p.title.replace(/"/g, "'").replace(/,/g, " ")}"`,
          url,
          subreddit: `r/${sub}`,
          time: new Date(p.created_utc * 1000).toISOString(),
          leadType: "TRADING_BOT",
          matchedTrigger: p.title.slice(0, 60).replace(/,/g, " "),
          product: "TRADINGBOT",
          budget,
          score
        };
        prependLead(leadsPath, row);
        existingUrls.add(url);
        leads++;
        console.log(`  + TRADING_BOT [r/${sub}] score:${score} budget:${budget||"unknown"}: u/${p.author.name} - "${p.title.slice(0, 50)}"`);
      }
    } catch (err) {
      console.log(`Error scraping r/${sub}: ${err.message}`);
      await wait(10000);
    }
  }
  return leads;
}

// ─── SCRAPE TRADING BOT GLOBAL SEARCH ────────────────────────────────────────
async function scrapeTradingBotSearch() {
  const existingUrls = new Set(
    fs.readFileSync(leadsPath, "utf8").split("\n").map(l => l.split(",")[2])
  );
  let leads = 0;

  for (const query of TRADINGBOT_QUERIES) {
    console.log(`Searching: "${query}" [TRADINGBOT]`);
    try {
      await wait(2000);
      const posts = await reddit.search({ query, sort: "new", time: "week", limit: 25 });
      for (const p of posts) {
        if (!p.author || !isFresh(p, 48)) continue;
        if (!isTradingBotLead(p)) continue;
        if (!isQualityAccount(p)) continue;

        const url = `https://reddit.com${p.permalink}`;
        if (existingUrls.has(url)) continue;

        const combined = `${p.title} ${p.selftext || ""}`;
        const budget = extractBudget(combined) || "";
        const score = scoreTradingBotLead(p);
        const triggerMatch = (p.title + " " + p.selftext).toLowerCase().match(tradingBotIntentRegex)?.[0] || "trading bot";

        const row = {
          username: p.author.name,
          title: `"${p.title.replace(/"/g, "'").replace(/,/g, " ")}"`,
          url,
          subreddit: p.subreddit_name_prefixed || p.subreddit,
          time: new Date(p.created_utc * 1000).toISOString(),
          leadType: "TRADING_BOT",
          matchedTrigger: triggerMatch,
          product: "TRADINGBOT",
          budget,
          score
        };
        prependLead(leadsPath, row);
        existingUrls.add(url);
        leads++;
        console.log(`  + TRADING_BOT_SEARCH: u/${p.author.name} - "${triggerMatch}"`);
      }
    } catch (err) {
      console.log(`Error searching "${query}": ${err.message}`);
      await wait(15000);
    }
  }
  return leads;
}

// ─── SCRAPE LOCKEDIN GLOBAL SEARCH ────────────────────────────────────────────
async function scrapeLockedIn() {
  const existingUrls = new Set(
    fs.readFileSync(leadsPath, "utf8").split("\n").map(l => l.split(",")[2])
  );
  let leads = 0;

  for (const query of LOCKEDIN_QUERIES) {
    console.log(`Searching: "${query}" [LOCKEDIN]`);
    try {
      await wait(2000);
      const posts = await reddit.search({ query, sort: "new", time: "day", limit: 100 });
      for (const p of posts) {
        if (!p.author || !isFresh(p, 24)) continue;
        if (!isLockedInLead(p)) continue;
        if (!isQualityAccount(p)) continue;

        const url = `https://reddit.com${p.permalink}`;
        if (existingUrls.has(url)) continue;

        const triggerMatch = (p.title + " " + p.selftext).toLowerCase().match(lockedInIntentRegex)?.[0] || "unproductive";
        const row = {
          username: p.author.name,
          title: `"${p.title.replace(/"/g, "'").replace(/,/g, " ")}"`,
          url,
          subreddit: p.subreddit_name_prefixed || p.subreddit,
          time: new Date(p.created_utc * 1000).toISOString(),
          leadType: "LOCKEDIN_INTENT",
          matchedTrigger: triggerMatch,
          product: "LOCKEDIN",
          budget: "",
          score: 45
        };
        prependLead(leadsPath, row);
        existingUrls.add(url);
        leads++;
        console.log(`  + LOCKEDIN_INTENT: u/${p.author.name} - "${triggerMatch}"`);
      }
    } catch (err) {
      console.log(`Error searching "${query}": ${err.message}`);
      await wait(15000);
    }
  }
  return leads;
}

async function scrape() {
  console.log("=".repeat(50));
  console.log("ClientMagnet -- DevHire + TradingBot + lockedIn");
  console.log("=".repeat(50));
  let leads = 0;
  leads += await scrapeDevHireSubreddits();
  leads += await scrapeTradingBotSubreddits();
  leads += await scrapeTradingBotSearch();
  leads += await scrapeLockedIn();
  console.log(`Scrape complete -- leads found: ${leads}`);
}

(async () => {
  while (true) {
    await scrape();
    await wait(30 * 60 * 1000);
  }
})();
