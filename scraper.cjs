// scraper.cjs — ClientMagnet Lead Scraper (v8 — near-miss diagnostic logging)
// v8: adds temporary NEAR_MISS logging so filtering behavior can be debugged
// from real data (what matched intent but got excluded, and why) instead of
// guessing at another round of regex changes blind.
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

const leadsPath    = path.join(baseDir, "clean_leads.csv");
const usersPath    = path.join(baseDir, "contacted_users.json");
const seenKeysPath = path.join(baseDir, "seen_keys.json");

const SCRAPE_INTERVAL_MS   = 5 * 60 * 1000;
const SEEN_KEYS_SAVE_EVERY = 10;
const MIN_BODY_LENGTH      = 40;

const csvHeader = [
  { id: "time", title: "Time" }, { id: "username", title: "Username" },
  { id: "title", title: "Title" }, { id: "url", title: "URL" },
  { id: "subreddit", title: "Subreddit" }, { id: "vertical", title: "Vertical" },
  { id: "leadType", title: "Lead Type" }, { id: "matchedTrigger", title: "Matched Trigger" },
  { id: "budget", title: "Budget" }, { id: "score", title: "Score" },
  { id: "moneySignal", title: "Money Signal" }, { id: "hiringFlair", title: "Hiring Flair" },
  { id: "painPhrase", title: "Pain Phrase" }, { id: "selftext", title: "Selftext" },
];

if (!fs.existsSync(leadsPath)) {
  fs.writeFileSync(leadsPath, csvHeader.map(h => h.title).join(",") + "\n");
}
const leadsWriter = createObjectCsvWriter({ path: leadsPath, header: csvHeader, append: true });

function log(tag, msg) { console.log(`[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

let seenPostKeys = new Set();
let sinceLastSave = 0;
function loadSeenKeys() {
  if (!fs.existsSync(seenKeysPath)) return new Set();
  try { return new Set(JSON.parse(fs.readFileSync(seenKeysPath, "utf8"))); } catch { return new Set(); }
}
function saveSeenKeys() {
  try { fs.writeFileSync(seenKeysPath, JSON.stringify([...seenPostKeys])); }
  catch (err) { log("WARN", `Failed to save seen_keys.json: ${err.message}`); }
}
function markSeen(key) {
  seenPostKeys.add(key);
  sinceLastSave++;
  if (sinceLastSave >= SEEN_KEYS_SAVE_EVERY) { saveSeenKeys(); sinceLastSave = 0; }
}
seenPostKeys = loadSeenKeys();
log("INFO", `Loaded ${seenPostKeys.size} previously seen post/comment keys from disk.`);

function loadContactedUsernames() {
  if (!fs.existsSync(usersPath)) return new Set();
  try { return new Set(Object.keys(JSON.parse(fs.readFileSync(usersPath, "utf8")))); } catch { return new Set(); }
}

// ---------- Where to look ----------
const SUBREDDITS = [
  "algotrading", "Daytrading", "FuturesTrading", "Forex", "Trading", "quant",
  "TradingView", "FTMO", "swingtrading", "options",
  "forhire", "hireadeveloper", "jobbit", "remotejs",
  "SaaS", "startups", "Entrepreneur", "EntrepreneurRideAlong", "smallbusiness",
  "sweatystartup", "smallbusinessowner", "juststart", "nocode", "automation",
  "webdev", "freelance", "digitalnomad", "sideproject", "indiehackers",
  "FulfillmentByAmazon", "AmazonFBA", "amazonseller", "Etsy", "EtsySellers",
  "shopify", "ecommerce", "dropship", "printondemand", "woocommerce",
  "HVAC", "Plumbing", "landscaping", "cleaningbusiness", "Contractor",
  "handyman", "Electricians", "Roofing", "PestControl", "autorepair",
  "PropertyManagement", "realestateinvesting", "Landlord",
];
const ALLOWED_SUBREDDITS = new Set(SUBREDDITS.map(s => s.toLowerCase()));

// ---------- Flair ----------
function flairSignal(post) {
  const title = (post.title || "").toLowerCase();
  const flair = (post.link_flair_text || "").toLowerCase();
  if (flair && /for.?hire|offer(ing)?|available|services/.test(flair)) return "REJECT";
  if (/\[for ?hire\]|\[offer\]|\[services\]|\[available\]|\[freelancer\]/i.test(title)) return "REJECT";
  if (/\[hiring\]|\[task\]|\[job\]|\[gig\]/i.test(title)) return "HIRING";
  return "NEUTRAL";
}

// ---------- Money ----------
function hasMoneySignal(text) {
  const moneyRegex = /\$\s?[\d,]+k?|\d+k?\s*(?:usd|dollars|bucks)|budget (of|is|around)|paying \$|willing to pay|flat fee|would pay|i'?d pay|pay someone|pay for|pay to have|pay well|paid (gig|work|project)/i;
  const match = text.match(moneyRegex);
  if (!match) return false;
  const before = text.slice(Math.max(0, match.index - 25), match.index);
  if (/\b(no|not|n't|zero|without|can'?t afford|unpaid|lacking)\b/i.test(before)) return false;
  return true;
}

function extractBudget(text) {
  const m = text.match(/\$\s?[\d,]+(?:k)?(?:\/(?:hr|hour|mo|month))?|\d+(?:\.\d+)?(?:k)?\s*(?:dollars|usd|budget)/i);
  return m ? m[0] : "";
}

// ---------- Intent regexes ----------
const painPhraseRegex = /\bi(?:'m| am)?\s*(?:keep|constantly|manually|spending|wasting|losing|struggling|falling behind|drowning in|tired of|sick of)\b[^.!?]{0,80}\b(manually|by hand|myself|every (day|week|time))\b|\bi wish there was\b|\bis there a tool\b|\bis there an app (for|that)\b|\bis there a way to automate\b|\bi need (a |to )?automate\b|\bi need help (managing|tracking|keeping up with)\b|\bit takes me (hours|forever|too long)\b|\bi'?m losing (sales|customers|money) because\b|\bi can'?t keep up with\b|\bi'?m falling behind on\b|\bi have no time to keep up with\b|\bi'?m juggling too many\b/i;

const hiringIntentRegex = /\bi(?:'m| am)?\s*(?:hiring|looking for|in search of|searching for|need|want|wanted|seeking)\b[\s\w]{0,20}\b(developer|dev|programmer|coder|engineer|freelancer|automation (expert|specialist)?|someone (who|to) (can )?(build|code|make|create))\b|\bwe(?:'re| are)?\s*(?:hiring|looking for|in search of|searching for|need|want|seeking)\b[\s\w]{0,20}\b(developer|dev|programmer|coder|engineer|freelancer)\b|\bany(one)? (recommendations for|know) a (good )?(developer|coder|programmer)\b|\bcan anyone (build|make|create|code) (this|me|my)\b|\bi'?m looking to (hire|automate|build)\b|\bi need (an|a) app (built|made)\b|\bi need custom (software|tool|script|bot)\b|\bi need (a |someone to )?(build|create|develop|code)\b|\bi'?m willing to pay (for|someone)\b/i;

const tradingIntentRegex = /\bi (need|want|am looking for|'m looking for) (someone|a developer|a coder|an ea developer)\b[^.!?]{0,40}\b(automate|build|code)\b|\bcan (anyone|someone) (build|code|make|automate)\b[^.!?]{0,30}\b(my )?(strategy|ea|bot|indicator)\b|\bi'?m looking for someone to (build|code|automate)\b|\bi need someone to (build|code|automate)\b[^.!?]{0,30}\b(strategy|ea|bot|indicator)\b|\bwilling to pay (someone|a developer)\b[^.!?]{0,30}\b(automate|build|code)\b|\bi want to hire\b[^.!?]{0,30}\b(trading|strategy|bot|ea)\b/i;

function extractPainPhrase(text) {
  const m = text.match(tradingIntentRegex) || text.match(hiringIntentRegex) || text.match(painPhraseRegex);
  return m ? m[0].slice(0, 80) : "";
}

// ---------- Exclusions ----------
const selfPromoExcludeRegex = /\bavailable for hire\b|\bmy services\b|\bhire me\b|\bdm me for rates\b|\bcheck out my (agency|portfolio|services|work)\b|\bi specialize in\b|\bfreelancer here\b|\bi offer\b|\bi provide services\b|\bour agency helps\b|\breaching out to offer\b|\bhappy to help you with\b|\bi can build (this|that|it) for you\b|\bi built\b|\bi've built\b|\bi published\b|\blaunching (a |my )?(new )?(project|product|app|tool|startup)\b|\blooking for (feedback|beta testers|people to test|users to test|early users|early adopters|x users)\b|\bwould (love|appreciate) (feedback|beta testers)\b/i;
const noCashCompRegex = /\b(equity only|revenue share|rev share|no upfront (pay|payment|cash)|unpaid but|profit share only)\b/i;
const coFounderExcludeRegex = /\b(co-?founder|technical co-?founder|equity[- ]based|founding (engineer|builder)|join (my|our) startup as)\b/i;
const findClientsExcludeRegex = /\bhow (do|can) i (find|get|land) clients\b|\blooking for (new )?clients\b|\bsearching for clients\b|\bclient acquisition (tips|advice)\b|\blooking for (freelance |contract )?(gigs|work)\b/i;
const careerChangeExcludeRegex = /\bwant(ed)? to (become|be|learn to be)\b[\s\w]{0,15}\b(developer|dev|programmer|coder|engineer)\b/i;
const advicePatternExcludeRegex = /\byou (can|should|could|might want to)\b[^.!?]{0,40}\bhire\b|\bi would (avoid|recommend|suggest)\b|\btry (using|looking at)\b|\bmy (advice|suggestion) (is|would be)\b/i;

function failsExcludes(fullText) {
  return selfPromoExcludeRegex.test(fullText) || noCashCompRegex.test(fullText) ||
    coFounderExcludeRegex.test(fullText) || findClientsExcludeRegex.test(fullText) ||
    careerChangeExcludeRegex.test(fullText) || advicePatternExcludeRegex.test(fullText);
}

// ---------- Verticals ----------
const tradingVerticalRegex = /\b(trading|trader|futures|forex|prop firm|topstep|apex|mt[45]|tradovate|ninjatrader|tradingview|pine ?script|mql|nasdaq|nq futures|es futures|gold futures|xauusd|backtest|expert advisor|algo ?trading)\b/i;
const ecommerceVerticalRegex = /\b(amazon|fba|etsy|shopify|inventory|listings?|repricing|product reviews?|dropship(ping)?|print on demand|woocommerce)\b/i;
const localServiceVerticalRegex = /\b(hvac|plumb(ing|er)?|landscap(ing|er)?|clean(ing)? (business|company)|handyman|contractor|job site|scheduling|appointments|invoic(e|ing)|electrician|roofing|pest control|auto repair|locksmith|detailing)\b/i;
const propertyVerticalRegex = /\b(tenant|lease|rent(al)?|property (management|manager)|landlord|maintenance request|units?\b)/i;

function detectVertical(text) {
  if (tradingVerticalRegex.test(text)) return "trading";
  if (ecommerceVerticalRegex.test(text)) return "ecommerce";
  if (propertyVerticalRegex.test(text)) return "property_mgmt";
  if (localServiceVerticalRegex.test(text)) return "local_service";
  return "general";
}

const QUERIES = [
  "automate my strategy", "looking for a bot developer", "EA developer",
  "need someone to code my strategy", "who can build me an EA",
  "code my indicator", "convert my strategy to a bot",
  "trading bot developer", "pine script developer",
  "someone to automate my trading", "pay someone to build my EA",
  "hire a developer for my strategy",
  "looking for a developer", "hiring a developer", "want to hire",
  "need to hire", "need someone to build", "can anyone build",
  "need custom software", "need an app built", "who can build me",
  "looking to automate", "need a script for", "need a programmer",
  "looking for a web developer", "willing to pay someone to build",
  "keep manually", "takes me hours", "spending too much time",
  "wish there was a tool", "manually updating", "manually tracking",
  "losing sales because", "can't keep up with", "need to automate this",
  "is there a way to automate", "tired of doing this manually",
  "would pay someone to automate", "need help managing", "wasting hours on",
  "sick of doing this by hand",
];

// ---------- Scoring ----------
function scoreLead(fullText, flair, vertical) {
  if (flair === "HIRING") return 100;
  if (hasMoneySignal(fullText)) return 90;
  if (vertical === "trading" && tradingIntentRegex.test(fullText)) return 85;
  if (hiringIntentRegex.test(fullText)) return 80;
  return 70;
}

function qualifiesPost(fullText, vertical, flair) {
  if (fullText.length < MIN_BODY_LENGTH) return false;
  if (flair === "REJECT") return false;
  if (failsExcludes(fullText)) return false;
  if (flair === "HIRING") return true;
  if (hiringIntentRegex.test(fullText)) return true;
  if (vertical === "trading") return tradingIntentRegex.test(fullText);
  if (vertical !== "general" && painPhraseRegex.test(fullText)) return true;
  return false;
}

function qualifiesComment(fullText, vertical) {
  if (fullText.length < MIN_BODY_LENGTH) return false;
  if (failsExcludes(fullText)) return false;
  if (hiringIntentRegex.test(fullText)) return true;
  if (vertical === "trading") return tradingIntentRegex.test(fullText);
  return false;
}

function buildLeadRecord(author, fullText, permalink, subredditLabel, trigger, leadType, flair) {
  const vertical = detectVertical(fullText);
  return {
    time: new Date().toISOString(), username: author,
    title: fullText.slice(0, 150), url: `https://reddit.com${permalink}`,
    subreddit: subredditLabel, vertical, leadType,
    matchedTrigger: trigger, budget: extractBudget(fullText),
    score: scoreLead(fullText, flair, vertical),
    moneySignal: hasMoneySignal(fullText) ? "YES" : "NO",
    hiringFlair: flair === "HIRING" ? "YES" : "NO",
    painPhrase: extractPainPhrase(fullText), selftext: fullText.slice(0, 500),
  };
}

async function writeLeadNow(lead) {
  try {
    await leadsWriter.writeRecords([lead]);
    log("LEAD", `[${lead.vertical.toUpperCase()}] score:${lead.score} u/${lead.username} in ${lead.subreddit} | ${lead.title.slice(0, 70)}`);
    return true;
  } catch (err) {
    log("ERROR", `Failed to write lead for u/${lead.username}: ${err.message}`);
    return false;
  }
}

async function scrapeSubredditPosts(subredditName, contactedUsers) {
  let count = 0;
  try {
    const posts = await reddit.getSubreddit(subredditName).getNew({ limit: 75 });
    for (const post of posts) {
      const key = `p_${post.id}`;
      if (seenPostKeys.has(key)) continue;
      markSeen(key);
      const author = post.author?.name;
      if (!author || author === "[deleted]" || author === "AutoModerator") continue;
      if (contactedUsers.has(author.toLowerCase())) continue;
      const flair = flairSignal(post);
      if (flair === "REJECT") continue;
      const fullText = `${post.title} ${post.selftext || ""}`;
      const vertical = detectVertical(fullText);
      const passes = qualifiesPost(fullText, vertical, flair);
      // Temporary diagnostic: surfaces anything matching real intent
      // language that got excluded, and why, so filtering can be tuned from
      // real data instead of guesswork.
      if (!passes && (hiringIntentRegex.test(fullText) || tradingIntentRegex.test(fullText))) {
        log("NEAR_MISS", `u/${author} in ${subredditName} | excluded:${failsExcludes(fullText)} | flair:${flair} | "${fullText.slice(0, 90)}"`);
      }
      if (!passes) continue;
      const lead = buildLeadRecord(author, fullText, post.permalink, subredditName, "subreddit_scan", "POST", flair);
      if (await writeLeadNow(lead)) count++;
    }
  } catch (err) { log("ERROR", `r/${subredditName} posts failed: ${err.message}`); }
  return count;
}

async function scrapeSubredditComments(subredditName, contactedUsers) {
  let count = 0;
  try {
    const comments = await reddit.getSubreddit(subredditName).getNewComments({ limit: 100 });
    for (const comment of comments) {
      const key = `c_${comment.id}`;
      if (seenPostKeys.has(key)) continue;
      markSeen(key);
      const author = comment.author?.name;
      if (!author || author === "[deleted]" || author === "AutoModerator") continue;
      if (contactedUsers.has(author.toLowerCase())) continue;
      if (!comment.body) continue;
      const fullText = comment.body;
      const vertical = detectVertical(fullText);
      const passes = qualifiesComment(fullText, vertical);
      if (!passes && (hiringIntentRegex.test(fullText) || tradingIntentRegex.test(fullText))) {
        log("NEAR_MISS", `u/${author} in ${subredditName} | excluded:${failsExcludes(fullText)} | "${fullText.slice(0, 90)}"`);
      }
      if (!passes) continue;
      const lead = buildLeadRecord(author, fullText, comment.permalink, subredditName, "comment_scan", "COMMENT", "NEUTRAL");
      if (await writeLeadNow(lead)) count++;
    }
  } catch (err) { log("ERROR", `r/${subredditName} comments failed: ${err.message}`); }
  return count;
}

async function globalSearch(query, contactedUsers) {
  let count = 0;
  try {
    const results = await reddit.search({ query, sort: "new", time: "day", limit: 25 });
    for (const post of results) {
      const key = `p_${post.id}`;
      if (seenPostKeys.has(key)) continue;
      markSeen(key);
      const subredditLabel = post.subreddit?.display_name || "unknown";
      if (!ALLOWED_SUBREDDITS.has(subredditLabel.toLowerCase())) continue;
      const author = post.author?.name;
      if (!author || author === "[deleted]" || author === "AutoModerator") continue;
      if (contactedUsers.has(author.toLowerCase())) continue;
      const flair = flairSignal(post);
      if (flair === "REJECT") continue;
      const fullText = `${post.title} ${post.selftext || ""}`;
      const vertical = detectVertical(fullText);
      const passes = qualifiesPost(fullText, vertical, flair);
      if (!passes && (hiringIntentRegex.test(fullText) || tradingIntentRegex.test(fullText))) {
        log("NEAR_MISS", `u/${author} in ${subredditLabel} (search:${query}) | excluded:${failsExcludes(fullText)} | flair:${flair} | "${fullText.slice(0, 90)}"`);
      }
      if (!passes) continue;
      const lead = buildLeadRecord(author, fullText, post.permalink, subredditLabel, query, "POST", flair);
      if (await writeLeadNow(lead)) count++;
    }
  } catch (err) { log("ERROR", `Search "${query}" failed: ${err.message}`); }
  return count;
}

async function runScrapeCycle() {
  log("INFO", "Scrape cycle starting...");
  const contactedUsers = loadContactedUsernames();
  let totalWritten = 0;
  for (const sub of SUBREDDITS) { totalWritten += await scrapeSubredditPosts(sub, contactedUsers); await sleep(2500); }
  for (const sub of SUBREDDITS) { totalWritten += await scrapeSubredditComments(sub, contactedUsers); await sleep(2500); }
  for (const query of QUERIES) { totalWritten += await globalSearch(query, contactedUsers); await sleep(2000); }
  saveSeenKeys();
  sinceLastSave = 0;
  log("INFO", `Cycle complete — ${totalWritten} lead(s) written this cycle.`);
  if (seenPostKeys.size > 30000) {
    seenPostKeys = new Set([...seenPostKeys].slice(-15000));
    saveSeenKeys();
  }
}

(async () => {
  console.log("ClientMagnet Scraper v8 — near-miss diagnostic logging");
  while (true) {
    await runScrapeCycle();
    log("INFO", `Next scrape in ${SCRAPE_INTERVAL_MS / 60000} minutes.`);
    await sleep(SCRAPE_INTERVAL_MS);
  }
})();
