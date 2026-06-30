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

const leadsPath = path.join(baseDir, "clean_leads.csv");
const HEADER = "username,title,url,subreddit,time,leadType,matchedTrigger,product,budget,score";

// Initialize CSV if it doesn't exist
if (!fs.existsSync(leadsPath)) {
  fs.writeFileSync(leadsPath, HEADER + "\n");
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
const wait = ms => new Promise(res => setTimeout(res, ms));

function prependLead(file, rowObj) {
  const row = Object.values(rowObj).map(v => `"${String(v).replace(/"/g, '""')}"`).join(",") + "\n";
  const lines = fs.readFileSync(file, "utf8").split("\n");
  if (!lines[0].startsWith("username")) lines.unshift(HEADER);
  lines.splice(1, 0, row.trim());
  fs.writeFileSync(file, lines.join("\n"));
}

function isFresh(post, maxHours = 12) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= maxHours;
}

function isGoodAccount(post) {
  if (!post.author) return false;
  const name = post.author.name.toLowerCase();
  if (name === "automoderator" || name.includes("bot") || name.includes("mod")) return false;

  const accountAgeDays = (Date.now() / 1000 - post.author.created_utc) / 86400;
  const karma = (post.author.link_karma || 0) + (post.author.comment_karma || 0);
  return accountAgeDays > 25 && karma > 40;
}

// ─── REGEXES ─────────────────────────────────────────────────────────────────
const offeringTagRegex = /^\s*\[(for hire|FH|FOR HIRE|offering|OFFERING|available|AVAILABLE)\]/i;
const offeringContentRegex = /\b(i am available for hire|hire me|my rates start|check out my portfolio|looking for clients|open to new clients|taking on new clients)\b/i;
const blockRegex = /\b(looking for a job|job hunting|resume|cover letter|applying for|interview prep|laid off|homework|assignment|school project)\b/i;

// DevHire
const hiringTagRegex = /^\s*\[(h|hiring|hire|paid|budget|job|project)\]/i;
const devHireBuyerRegex = /\b(looking to hire|need to hire|hiring (a |an )?(developer|dev|programmer|coder)|need (a |an )?(developer|dev|programmer|coder)|need someone to (build|create|code|fix|scrape|automate|develop)|can someone build|anyone able to build|who can build)\b/i;
const quickGigRegex = /\b(quick|small|simple|fast|short term|one time|one-off|small project|script|bot|scraper|automation|tool|dashboard|api integration)\b/i;
const devHireBlockRegex = /\b(full time|full-time|permanent|long term|ongoing|monthly retainer|equity|intern|internship|senior developer|lead developer)\b/i;

// Trading Bot
const tradingBotIntentRegex = /\b(automate (my |a |the )?(trading|strategy|trades)|trading bot|algo trading bot|need (a |someone to build )?(bot|script|automation) (for|to) (trade|trading)|TradingView (alert|webhook) automation|futures trading bot|forex trading automation)\b/i;
const tradingBuyerRegex = /\b(looking for (a |an )?(developer|dev)|need (a |an )?(developer|dev)|hire|hiring|paid|budget|will pay|build me|can someone build|anyone able to build)\b/i;
const tradingBlockRegex = /\b(just sharing|my results|my pnl|how i trade|my approach|what do you think|rate my|review my|paper trading journey|new to trading)\b/i;

// LockedIn
const lockedInIntentRegex = /\b(waste (time|my morning)|can't (stick to|organize|manage|get anything done)|struggling (to|with) (manage|organize|plan)|overwhelmed (with|by) (tasks)|no structure|chaotic day|unproductive|procrastinat|too many tasks|can never finish|lose hours|morning routine|time blocking|plan my day|ADHD and (can't|struggle))\b/i;
const firstPersonBuyerRegex = /\b(i need help|i need someone to|i'm looking for|i am looking for|i need to (fix|stop)|i can never|i struggle (to|with)|i keep (failing|losing)|i have (tried|been trying)|i can't seem to)\b/i;

// Budget & Urgency
const budgetRegex = /\$\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(k|K)?|\b(\d+(?:,\d{3})*)\s*(dollars?|usd|budget)\b/i;
const urgencyRegex = /\b(urgent|urgently|asap|as soon as possible|today|immediately|right away|need it done fast|rush|by tomorrow|eod)\b/i;

// ─── SCORING ─────────────────────────────────────────────────────────────────
function extractBudget(text) {
  const match = text.match(budgetRegex);
  return match ? match[0].trim().slice(0, 25) : "";
}

function scoreDevHireLead(post) {
  let score = 35;
  const combined = `${post.title} ${post.selftext || ""}`.toLowerCase();

  if (budgetRegex.test(combined)) score += 25;
  if (urgencyRegex.test(combined)) score += 20;
  if (quickGigRegex.test(combined)) score += 15;
  if (/bot|scraper|automation|script|api|dashboard/.test(combined)) score += 12;
  if (/\$[3-9]\d{2}|\$[1-9]\d{3}/.test(combined)) score += 15;

  if (devHireBlockRegex.test(combined)) score -= 35;
  if (/full time|full-time|permanent|long term/.test(combined)) score -= 30;

  return Math.max(0, score);
}

function scoreTradingBotLead(post) {
  let score = 50;
  const combined = `${post.title} ${post.selftext || ""}`.toLowerCase();

  if (budgetRegex.test(combined)) score += 25;
  if (urgencyRegex.test(combined)) score += 15;
  if (/\$[5-9]\d{2}|\$[1-9]\d{3}/.test(combined)) score += 20;
  if (/kraken|coinbase|interactive brokers|tradovate|topstep|funded/.test(combined)) score += 12;
  if (/futures|forex|crypto|options/.test(combined)) score += 8;

  return Math.max(0, score);
}

// ─── LEAD FILTERS ────────────────────────────────────────────────────────────
function isHiringPost(post) {
  const title = post.title || "";
  const body = post.selftext || "";
  const combined = `${title} ${body}`.toLowerCase();

  if (offeringTagRegex.test(title)) return false;
  if (offeringContentRegex.test(combined)) return false;
  if (blockRegex.test(combined)) return false;
  if (devHireBlockRegex.test(combined)) return false;

  const hasTag = hiringTagRegex.test(title);
  const hasBuyer = devHireBuyerRegex.test(combined);
  const hasQuickGig = quickGigRegex.test(combined);

  return hasBuyer && (hasTag || hasQuickGig);
}

function isTradingBotLead(post) {
  const title = post.title || "";
  const body = post.selftext || "";
  const combined = `${title} ${body}`.toLowerCase();

  if (offeringTagRegex.test(title)) return false;
  if (offeringContentRegex.test(combined)) return false;
  if (tradingBlockRegex.test(combined)) return false;

  const hasIntent = tradingBotIntentRegex.test(combined);
  const hasBuyer = tradingBuyerRegex.test(combined);

  return hasIntent && hasBuyer;
}

function isLockedInLead(post) {
  const title = (post.title || "").toLowerCase();
  const body = (post.selftext || "").toLowerCase();
  const combined = `${title} ${body}`;

  if (title.length < 12) return false;
  if (offeringTagRegex.test(post.title)) return false;
  if (offeringContentRegex.test(combined)) return false;
  if (blockRegex.test(combined)) return false;

  return lockedInIntentRegex.test(combined) && firstPersonBuyerRegex.test(combined);
}

// ─── SCRAPERS ────────────────────────────────────────────────────────────────
async function scrapeDevHireSubreddits() {
  const DEVHIRE_SUBS = ["forhire", "slavelabour", "freelance_forhire", "freelancer_hire", "freelanceprogramming", "DoneDirtCheap", "startups", "Entrepreneur", "smallbusiness"];

  let newLeads = 0;
  const existing = new Set(fs.readFileSync(leadsPath, "utf8").split("\n").map(l => l.split(",")[2]));

  for (const sub of DEVHIRE_SUBS) {
    console.log(`[DevHire] Scraping r/${sub}...`);
    try {
      await wait(1800);
      const posts = await reddit.getSubreddit(sub).getNew({ limit: 80 });

      for (const p of posts) {
        if (!isFresh(p, 8) || !isHiringPost(p) || !isGoodAccount(p)) continue;

        const url = `https://reddit.com${p.permalink}`;
        if (existing.has(url)) continue;

        const combined = `${p.title} ${p.selftext || ""}`;
        const score = scoreDevHireLead(p);
        if (score < 55) continue; // Quality gate

        const budget = extractBudget(combined);
        const isUrgent = urgencyRegex.test(combined);

        const row = {
          username: p.author.name,
          title: p.title.replace(/"/g, "'").slice(0, 180),
          url,
          subreddit: `r/${sub}`,
          time: new Date(p.created_utc * 1000).toISOString(),
          leadType: isUrgent ? "DEV_HIRE_URGENT" : "DEV_HIRE_SUBREDDIT",
          matchedTrigger: p.title.slice(0, 70),
          product: "DEVHIRE",
          budget,
          score
        };

        prependLead(leadsPath, row);
        existing.add(url);
        newLeads++;
        console.log(`  + DevHire [score:${score}] u/${p.author.name} - ${p.title.slice(0, 55)}`);
      }
    } catch (err) {
      console.log(`Error in r/${sub}: ${err.message}`);
      await wait(8000);
    }
  }
  return newLeads;
}

async function scrapeTradingBot() {
  // Add your TRADINGBOT_SUBREDDITS + search logic here (same structure as before)
  // For brevity, keeping the same logic but with the improved isTradingBotLead() + score gate
  console.log("[TradingBot] Scraping trading subs + search...");
  // You can paste your previous trading bot scraping logic here with the updated filters
  return 0; // placeholder until you add it back
}

async function scrapeLockedIn() {
  const LOCKEDIN_QUERIES = [ /* your list */ ];

  let newLeads = 0;
  const existing = new Set(fs.readFileSync(leadsPath, "utf8").split("\n").map(l => l.split(",")[2]));

  for (const query of LOCKEDIN_QUERIES) {
    console.log(`[LockedIn] Searching: "${query}"`);
    try {
      await wait(1500);
      const posts = await reddit.search({ query, sort: "new", time: "day", limit: 80 });

      for (const p of posts) {
        if (!isFresh(p, 24) || !isLockedInLead(p) || !isGoodAccount(p)) continue;

        const url = `https://reddit.com${p.permalink}`;
        if (existing.has(url)) continue;

        const trigger = (p.title + " " + p.selftext).toLowerCase().match(lockedInIntentRegex)?.[0] || "productivity";

        const row = {
          username: p.author.name,
          title: p.title.replace(/"/g, "'").slice(0, 180),
          url,
          subreddit: p.subreddit_name_prefixed,
          time: new Date(p.created_utc * 1000).toISOString(),
          leadType: "LOCKEDIN_INTENT",
          matchedTrigger: trigger,
          product: "LOCKEDIN",
          budget: "",
          score: 48
        };

        prependLead(leadsPath, row);
        existing.add(url);
        newLeads++;
        console.log(`  + LockedIn: u/${p.author.name} - ${trigger}`);
      }
    } catch (err) {
      console.log(`Error searching "${query}": ${err.message}`);
      await wait(10000);
    }
  }
  return newLeads;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function scrapeAll() {
  console.log("\n" + "=".repeat(55));
  console.log("ClientMagnet Scraper - Improved Targeting");
  console.log("=".repeat(55));

  let total = 0;
  total += await scrapeDevHireSubreddits();
  total += await scrapeTradingBot();     // Add your trading logic here
  total += await scrapeLockedIn();

  console.log(`\nScrape complete. New leads added: ${total}`);
}

(async () => {
  while (true) {
    await scrapeAll();
    console.log("Waiting 35 minutes before next scrape...\n");
    await wait(35 * 60 * 1000);
  }
})();
