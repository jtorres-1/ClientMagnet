// scraper.cjs — ClientMagnet Lead Scraper (v9 — backlog harvest + buyer-only targeting)
//
// v9, Sep 23. Three changes that matter.
//
// 1. BACKLOG. v8 only ever read new posts going forward, which capped the
//    whole engine at whatever those subs happened to produce today. Reddit
//    has months of people asking for exactly what we sell and none of them
//    have been contacted. `node scraper.cjs --backfill` sweeps up to 180
//    days once, then the live loop takes over. The backlog is the volume.
//
// 2. TARGETING. Cut 50 subs to 18. Dropped the trades subs, Etsy, dropship,
//    woocommerce and friends (never produced a lead) and dropped webdev,
//    freelance and digitalnomad, which are full of competitors rather than
//    buyers. Kept the trading subs, the three hiring subs, and the business
//    owner subs that produced the biggest past quotes.
//
// 3. FILTERS. Two exclusions in v8 were throwing out the best leads:
//      - `i built` / `i've built` was tagged as self-promo. The single most
//        common qualified post on r/algotrading opens "I built a strategy in
//        Pine Script but I can't code it into a bot." That is the customer.
//        Promo is still caught by `check out my`, `launching`, `feedback`.
//      - `try using` / `try looking at` killed any post that mentioned a
//        tool the person had already tried, which qualified leads always do.
//    Added a DIY detector instead: someone saying they're learning Python to
//    build it themselves is not a buyer, and that is a far better filter than
//    either of the two removed.
//
// Age handling: hiring posts with a flair and a budget are filled or
// abandoned within weeks, so those cap at 30 days. Pain and intent posts
// don't decay the same way — an unautomated strategy is usually still
// unautomated six months later — so those run to 180. The DM bot reads
// Age Days off the CSV and changes the opener accordingly.

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
reddit.config({ requestDelay: 1100, continueAfterRatelimitError: true, retryErrorCodes: [502, 503, 504, 522] });

const BACKFILL = process.argv.includes("--backfill");
const VERBOSE  = process.argv.includes("--verbose");

const baseDir = path.resolve(__dirname, "logs");
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

const leadsPath    = path.join(baseDir, "clean_leads.csv");
const usersPath    = path.join(baseDir, "contacted_users.json");
const seenKeysPath = path.join(baseDir, "seen_keys.json");

const SCRAPE_INTERVAL_MS = 5 * 60 * 1000;
const SEEN_KEYS_SAVE_EVERY = 25;
const MIN_BODY_LENGTH = 40;   // comments, which are noisier
// v9.1: posts were held to 40 too, which rejected "Anyone know a good MQL5
// dev?" at 28 characters. Plenty of the best leads are a short title and an
// empty body.
const MIN_POST_LENGTH = 25;

const MAX_AGE_DAYS_HIRING = 30;   // flaired/budgeted gigs get filled fast
const MAX_AGE_DAYS_PAIN   = 180;  // an unbuilt bot stays unbuilt

const csvHeader = [
  { id: "time", title: "Time" }, { id: "username", title: "Username" },
  { id: "title", title: "Title" }, { id: "url", title: "URL" },
  { id: "subreddit", title: "Subreddit" }, { id: "vertical", title: "Vertical" },
  { id: "leadType", title: "Lead Type" }, { id: "matchedTrigger", title: "Matched Trigger" },
  { id: "budget", title: "Budget" }, { id: "score", title: "Score" },
  { id: "moneySignal", title: "Money Signal" }, { id: "hiringFlair", title: "Hiring Flair" },
  { id: "painPhrase", title: "Pain Phrase" },
  { id: "ageDays", title: "Age Days" }, { id: "postedAt", title: "Posted At" },
  { id: "intent", title: "Intent" }, { id: "accounts", title: "Accounts" },
  { id: "selftext", title: "Selftext" },
];

// v9 added columns. If an old v8 CSV is sitting there, move it aside rather
// than appending rows the DM bot can't read.
if (fs.existsSync(leadsPath)) {
  const firstLine = fs.readFileSync(leadsPath, "utf8").split("\n")[0] || "";
  if (!firstLine.includes("Age Days")) {
    const archived = path.join(baseDir, `clean_leads_v8_${Date.now()}.csv`);
    fs.renameSync(leadsPath, archived);
    console.log(`Archived old-format CSV to ${path.basename(archived)}`);
  }
}
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
  if (++sinceLastSave >= SEEN_KEYS_SAVE_EVERY) { saveSeenKeys(); sinceLastSave = 0; }
}
seenPostKeys = loadSeenKeys();
log("INFO", `Loaded ${seenPostKeys.size} previously seen keys from disk.`);

function loadContactedUsernames() {
  if (!fs.existsSync(usersPath)) return new Set();
  try { return new Set(Object.keys(JSON.parse(fs.readFileSync(usersPath, "utf8")))); } catch { return new Set(); }
}

// ---------- Where to look ----------
// 18 subs. Trading is the core offer, the hiring subs are where people post
// with a budget already in hand, and the owner subs are where every big past
// quote came from (the $2K RFQ tool, the $1.5K flat, the Upwork screener).
const TRADING_SUBS = [
  "algotrading", "Daytrading", "FuturesTrading", "Forex", "Trading",
  "TradingView", "FTMO", "quant", "swingtrading",
];
const HIRING_SUBS = ["forhire", "hireadeveloper", "jobbit"];
const OWNER_SUBS = [
  "smallbusiness", "Entrepreneur", "EntrepreneurRideAlong",
  "sweatystartup", "SaaS", "ecommerce",
];
const SUBREDDITS = [...TRADING_SUBS, ...HIRING_SUBS, ...OWNER_SUBS];
const ALLOWED_SUBREDDITS = new Set(SUBREDDITS.map(s => s.toLowerCase()));
const TRADING_SUB_SET = new Set(TRADING_SUBS.map(s => s.toLowerCase()));

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

// ---------- Intent ----------
const painPhraseRegex = /\bi(?:'m| am)?\s*(?:keep|constantly|manually|spending|wasting|losing|struggling|falling behind|drowning in|tired of|sick of)\b[^.!?]{0,80}\b(manually|by hand|myself|every (day|week|time))\b|\bi wish there was\b|\bis there a tool\b|\bis there an app (for|that)\b|\bis there a way to automate\b|\bi need (a |to )?automate\b|\bi need help (managing|tracking|keeping up with)\b|\bit takes me (hours|forever|too long)\b|\bi'?m losing (sales|customers|money) because\b|\bi can'?t keep up with\b|\bi'?m falling behind on\b|\bi have no time to keep up with\b|\bi'?m juggling too many\b/i;

const hiringIntentRegex = /\bi(?:'m| am)?\s*(?:hiring|looking for|in search of|searching for|need|want|wanted|seeking)\b[\s\w]{0,20}\b(developer|dev|programmer|coder|engineer|freelancer|automation (expert|specialist)?|someone (who|to) (can )?(build|code|make|create))\b|\bwe(?:'re| are)?\s*(?:hiring|looking for|in search of|searching for|need|want|seeking)\b[\s\w]{0,20}\b(developer|dev|programmer|coder|engineer|freelancer)\b|\bany(one)? (recommendations for|know) a (good )?(developer|coder|programmer)\b|\bcan anyone (build|make|create|code) (this|me|my)\b|\bi'?m looking to (hire|automate|build)\b|\bi need (an|a) app (built|made)\b|\bi need custom (software|tool|script|bot)\b|\bi need (a |someone to )?(build|create|develop|code)\b|\bi'?m willing to pay (for|someone)\b/i;

// v9.1: the original only matched a handful of exact phrasings. Tested
// against 16 real ways people ask for this on r/algotrading and r/Forex it
// caught zero, which is why a 180 day sweep of Forex returned nothing. This
// version is built from three signals (an ask, a build verb, a trading
// object) in either order, plus a direct "<trading word> developer" form.
// 15/16 on that same sample, and the one false positive it lets through
// ("available for hire, i build trading bots") is already killed by the
// self-promo exclusion below.
const T_OBJ = "(?:ea|eas|expert advisors?|bots?|robots?|algos?|algorithms?|indicators?|strategy|strategies|system|script|automation)";
const T_BLD = "(?:builds?|building|built|codes?|coding|coded|develops?|developing|developed|programs?|programming|programmed|automates?|automating|automated|converts?|converting|creates?|creating|makes?|making|writ(?:e|es|ing)|turn(?:s|ing)?[^.!?]{0,25}into|port(?:ing|ed|s)?)";
const T_ASK = "(?:need|needs|needed|want|wants|looking for|looking to|hoping to|in search of|searching for|hire|hiring|pay|paying|willing to pay|would pay|happy to pay|commission|how much|how do i (?:get|turn|make)|where (?:can|do) i (?:find|get)|trying to find|who can|can (?:anyone|someone)|any(?:one)? (?:know|recommend)|recommendations for|help me|is there (?:anyone|someone)|(?:i.?d|i would) like to)";
const T_PAY = "(?:hire|hiring|commission|pay|paying|willing to pay|would pay|happy to pay|how much|quote for)";
const T_CANT = "(?:can.?t|cannot|unable to|don.?t know how to|no idea how to)";
const T_DEV = "(?:dev|devs|developer|developers|coder|coders|programmer|programmers|engineer)";
const T_WORD = "(?:mql[45]?|pine ?script|ea|expert advisor|mt[45]|metatrader|ninjatrader|thinkscript|trading|algo|forex|futures|bot)";
const tradingIntentRegex = new RegExp([
  `\\b${T_ASK}\\b[^.!?]{0,70}\\b${T_BLD}\\b[^.!?]{0,45}\\b${T_OBJ}\\b`,
  `\\b${T_ASK}\\b[^.!?]{0,70}\\b${T_OBJ}\\b[^.!?]{0,45}\\b${T_BLD}\\b`,
  `\\b${T_WORD}\\b[ -]?\\b${T_DEV}\\b`,
  `\\b${T_DEV}\\b[^.!?]{0,30}\\b${T_BLD}\\b[^.!?]{0,30}\\b${T_OBJ}\\b`,
  `\\b${T_PAY}\\b[^.!?]{0,40}\\b${T_OBJ}\\b`,
  `\\b${T_CANT}\\b[^.!?]{0,25}\\b${T_BLD}\\b[^.!?]{0,45}\\b${T_OBJ}\\b`,
  `\\b${T_OBJ}\\b[^.!?]{0,40}\\b${T_ASK}\\b[^.!?]{0,25}\\b${T_BLD}\\b`,
].join("|"), "i");

// Someone running several prop accounts is the dashboard buyer, not the bot
// buyer. Different message, so the DM bot needs it flagged here.
const multiAccountRegex = /\b(\d{1,2})\s*(prop|funded|eval(uation)?|combine|challenge)?\s*(accounts?|evals?|challenges?)\b|\b(multiple|several|a few|bunch of)\s*(prop|funded|eval(uation)?)?\s*(accounts?|evals?|firms?)\b|\bacross\s*(\d{1,2}|multiple|several)\s*(firms?|accounts?|evals?)\b/i;

function extractAccountCount(text) {
  const m = text.match(/\b(\d{1,2})\s*(?:prop |funded |eval(?:uation)? |combine |challenge )?(?:accounts?|evals?|challenges?)\b/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 2 && n <= 60) return String(n);
  }
  return multiAccountRegex.test(text) ? "multiple" : "";
}

function extractPainPhrase(text) {
  const m = text.match(tradingIntentRegex) || text.match(hiringIntentRegex) || text.match(painPhraseRegex);
  if (!m) return "";
  // Commas break the CSV downstream and the DM bot drops this straight into
  // a sentence, so trim to a clean fragment.
  return m[0].replace(/[\r\n]+/g, " ").replace(/,/g, "").trim().slice(0, 90);
}

// ---------- Exclusions ----------
// v9: `i built` / `i've built` and `try using` / `try looking at` removed.
// See the header note. Self-promo is still caught by the launch/feedback/
// check-out-my patterns, which is what actually marks a promo post.
const selfPromoExcludeRegex = /\bavailable for hire\b|\bmy services\b|\bhire me\b|\bdm me for rates\b|\bcheck out my (agency|portfolio|services|work|tool|app|project)\b|\bi specialize in\b|\bfreelancer here\b|\bi provide services\b|\bour agency helps\b|\breaching out to offer\b|\bi can build (this|that|it) for you\b|\bi published\b|\blaunching (a |my )?(new )?(project|product|app|tool|startup)\b|\b(just|i) (launched|released|shipped)\b|\blooking for (feedback|beta testers|people to test|users to test|early users|early adopters)\b|\bwould (love|appreciate) (feedback|beta testers)\b|\bfree to (try|use), (link|dm)\b/i;
const noCashCompRegex = /\b(equity only|revenue share|rev share|no upfront (pay|payment|cash)|unpaid but|profit share only)\b/i;
const coFounderExcludeRegex = /\b(co-?founder|technical co-?founder|equity[- ]based|founding (engineer|builder)|join (my|our) startup as)\b/i;
const findClientsExcludeRegex = /\bhow (do|can) i (find|get|land) clients\b|\blooking for (new )?clients\b|\bsearching for clients\b|\bclient acquisition (tips|advice)\b|\blooking for (freelance |contract )?(gigs|work)\b/i;
const careerChangeExcludeRegex = /\bwant(ed)? to (become|be|learn to be)\b[\s\w]{0,15}\b(developer|dev|programmer|coder|engineer)\b/i;
const advicePatternExcludeRegex = /\byou (can|should|could|might want to)\b[^.!?]{0,40}\bhire\b|\bi would (avoid|recommend|suggest)\b|\bmy (advice|suggestion) (is|would be)\b/i;

// New in v9. Replaces the two removed exclusions and does a better job: the
// person who is going to write it themselves is the one to skip, not the
// person who already wrote something.
const diyHardExcludeRegex = /\bi'?(ll|m going to| will) (build|code|write|make) (it|this|my own)\b|\bdecided to (build|code|write) (it|this) myself\b|\bbuilding (it|this|my own) myself\b|\bwriting (it|the code) myself\b|\bdon'?t want to (pay|hire)\b|\bno budget\b|\bcan'?t afford (a |to )?(dev|developer|hire)\b|\bfree (alternative|option|tool)\b|\bopen source (alternative|option)\b/i;
const diySoftSignalRegex = /\bi'?m a (developer|programmer|software engineer|swe)\b|\bi code for a living\b|\bi'?m learning (python|to code|programming)\b|\bteaching myself (python|to code)\b|\bi know (python|java|c\+\+)\b/i;

function failsExcludes(fullText) {
  return selfPromoExcludeRegex.test(fullText) || noCashCompRegex.test(fullText) ||
    coFounderExcludeRegex.test(fullText) || findClientsExcludeRegex.test(fullText) ||
    careerChangeExcludeRegex.test(fullText) || advicePatternExcludeRegex.test(fullText) ||
    diyHardExcludeRegex.test(fullText);
}

// ---------- Verticals ----------
// v9: "6 prop accounts across three firms" used to fall through to general,
// which sent the dashboard buyer the business automation copy. prop/funded/
// eval account language now counts as trading on its own.
const tradingVerticalRegex = /\b(trading|trader|futures|forex|prop ?(firm|account)s?|funded account|eval(uation)? accounts?|evals?|combine|topstep|apex|tradeify|lucid|mt[45]|tradovate|ninjatrader|tradingview|pine ?script|mql|nasdaq|nq futures|es futures|gold futures|xauusd|backtest|expert advisors?|trading bots?|forex bots?|algo ?trading|algotrading)\b/i;
const ecommerceVerticalRegex = /\b(amazon|fba|etsy|shopify|inventory|listings?|repricing|product reviews?|dropship(ping)?|print on demand|woocommerce)\b/i;
const localServiceVerticalRegex = /\b(hvac|plumb(ing|er)?|landscap(ing|er)?|clean(ing)? (business|company)|handyman|contractor|job site|scheduling|appointments|invoic(e|ing)|electrician|roofing|pest control|auto repair|locksmith|detailing)\b/i;
const propertyVerticalRegex = /\b(tenant|lease|rent(al)?|property (management|manager)|landlord|maintenance request)\b/i;

// v9.1: the subreddit decides context before the text does. "turn my
// strategy into an EA" contains no word from the vertical list, so it used
// to come back general, fail the business filter, and never reach the
// trading intent check at all. A post in r/algotrading is trading, full
// stop. Bare "ea" deliberately stays out of the keyword list because in
// r/Entrepreneur it means executive assistant.
function detectVertical(text, sub) {
  if (sub && TRADING_SUB_SET.has(String(sub).toLowerCase())) return "trading";
  if (tradingVerticalRegex.test(text)) return "trading";
  if (ecommerceVerticalRegex.test(text)) return "ecommerce";
  if (propertyVerticalRegex.test(text)) return "property_mgmt";
  if (localServiceVerticalRegex.test(text)) return "local_service";
  return "general";
}

// Which message the DM bot should reach for. Vertical says what industry,
// intent says what they actually want built.
function detectIntent(text, vertical) {
  if (vertical === "trading" && multiAccountRegex.test(text)) return "dashboard";
  if (vertical === "trading") {
    if (/\b(my|our) (strategy|ea|system|setup|indicator)\b|\bpine ?script\b|\bmql[45]?\b|\bi have (a|my) (strategy|system)\b/i.test(text)) {
      return "trading_custom";
    }
    return "trading_install";
  }
  return "business";
}

// ---------- Queries ----------
const LIVE_QUERIES = [
  "automate my strategy", "looking for a bot developer", "EA developer",
  "need someone to code my strategy", "who can build me an EA",
  "code my indicator", "convert my strategy to a bot",
  "trading bot developer", "pine script developer",
  "someone to automate my trading", "pay someone to build my EA",
  "hire a developer for my strategy",
  "looking for a developer", "hiring a developer", "need someone to build",
  "can anyone build", "need custom software", "need an app built",
  "looking to automate", "need a script for", "need a programmer",
  "willing to pay someone to build",
  "keep manually", "takes me hours", "spending too much time",
  "wish there was a tool", "manually tracking", "can't keep up with",
  "is there a way to automate", "would pay someone to automate",
];

// Backfill runs per subreddit, so these stay short and high signal. Reddit
// caps any single listing around 1000 items, which is why this is many
// narrow queries across several sorts rather than one deep crawl.
const BACKFILL_QUERIES = [
  "automate my strategy", "code my strategy", "build my EA", "EA developer",
  "pine script developer", "convert my strategy", "someone to code",
  "someone to build", "looking for a developer", "hire a developer",
  "need a programmer", "custom bot", "automate this", "need this automated",
  "willing to pay", "paid project", "can anyone build", "doing it manually",
  "takes me hours", "wish there was a tool",
];
const BACKFILL_SORTS = ["new", "relevance", "top"];

// ---------- Scoring ----------
function scoreLead(fullText, flair, vertical, ageDays, intent) {
  let score;
  if (flair === "HIRING") score = 100;
  else if (hasMoneySignal(fullText)) score = 90;
  else if (vertical === "trading" && tradingIntentRegex.test(fullText)) score = 85;
  else if (hiringIntentRegex.test(fullText)) score = 80;
  else score = 70;

  if (intent === "dashboard") score += 8;          // highest ticket offer
  if (diySoftSignalRegex.test(fullText)) score -= 15; // may well build it himself

  // Age decay. Fresh posts convert far better, so they sort to the top of
  // the DM queue, but an old one still gets contacted.
  if (ageDays > 120) score -= 12;
  else if (ageDays > 60) score -= 8;
  else if (ageDays > 21) score -= 4;
  else if (ageDays <= 1) score += 5;

  return Math.max(1, Math.min(120, Math.round(score)));
}

function maxAgeFor(flair) {
  return flair === "HIRING" ? MAX_AGE_DAYS_HIRING : MAX_AGE_DAYS_PAIN;
}

// v9.1: the dashboard buyer had no path through here. "I run 6 prop accounts
// and need something to track them all" has no build verb and no trading
// object, so the intent regex rejected the highest ticket lead on the board.
// Multiple accounts plus any ask is enough on its own.
const dashAskRegex = /\b(need|want|looking for|trying to|how do (?:i|you)|is there|any(?:one|thing)|wish|struggl|keep(?:ing)? track|track(?:ing)?|monitor(?:ing)?|manage|managing)\b/i;

function qualifiesPost(fullText, vertical, flair) {
  if (fullText.length < MIN_POST_LENGTH) return false;
  if (flair === "REJECT") return false;
  if (failsExcludes(fullText)) return false;
  if (flair === "HIRING") return true;
  if (hiringIntentRegex.test(fullText)) return true;
  if (vertical === "trading") {
    if (tradingIntentRegex.test(fullText)) return true;
    if (multiAccountRegex.test(fullText) && dashAskRegex.test(fullText)) return true;
    return false;
  }
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

function ageDaysOf(createdUtc) {
  if (!createdUtc) return 0;
  return Math.max(0, (Date.now() / 1000 - createdUtc) / 86400);
}

function buildLeadRecord(author, fullText, permalink, subredditLabel, trigger, leadType, flair, createdUtc) {
  const vertical = detectVertical(fullText, subredditLabel);
  const intent = detectIntent(fullText, vertical);
  const ageDays = ageDaysOf(createdUtc);
  return {
    time: new Date().toISOString(),
    username: author,
    title: fullText.slice(0, 150).replace(/[\r\n]+/g, " ").replace(/,/g, " "),
    url: `https://reddit.com${permalink}`,
    subreddit: subredditLabel,
    vertical,
    leadType,
    matchedTrigger: trigger,
    budget: extractBudget(fullText),
    score: scoreLead(fullText, flair, vertical, ageDays, intent),
    moneySignal: hasMoneySignal(fullText) ? "YES" : "NO",
    hiringFlair: flair === "HIRING" ? "YES" : "NO",
    painPhrase: extractPainPhrase(fullText),
    ageDays: ageDays.toFixed(1),
    postedAt: createdUtc ? new Date(createdUtc * 1000).toISOString() : "",
    intent,
    accounts: extractAccountCount(fullText),
    selftext: fullText.slice(0, 500).replace(/[\r\n]+/g, " ").replace(/,/g, " "),
  };
}

async function writeLeadNow(lead) {
  try {
    await leadsWriter.writeRecords([lead]);
    log("LEAD", `[${lead.intent}] score:${lead.score} age:${lead.ageDays}d u/${lead.username} in ${lead.subreddit} | ${lead.title.slice(0, 62)}`);
    return true;
  } catch (err) {
    log("ERROR", `Failed to write lead for u/${lead.username}: ${err.message}`);
    return false;
  }
}

// Shared handling for anything that looks like a post.
async function considerPost(post, subredditLabel, trigger, contactedUsers, writtenUsers) {
  const key = `p_${post.id}`;
  if (seenPostKeys.has(key)) return 0;
  markSeen(key);

  const author = post.author && post.author.name;
  if (!author || author === "[deleted]" || author === "AutoModerator") return 0;
  const authorKey = author.toLowerCase();
  if (contactedUsers.has(authorKey)) return 0;
  if (writtenUsers.has(authorKey)) return 0; // one row per person per run

  const flair = flairSignal(post);
  if (flair === "REJECT") return 0;

  const ageDays = ageDaysOf(post.created_utc);
  if (ageDays > maxAgeFor(flair)) return 0;

  const fullText = `${post.title || ""} ${post.selftext || ""}`;
  const vertical = detectVertical(fullText, subredditLabel);
  const passes = qualifiesPost(fullText, vertical, flair);

  if (!passes && VERBOSE && (hiringIntentRegex.test(fullText) || tradingIntentRegex.test(fullText))) {
    log("NEAR_MISS", `u/${author} in ${subredditLabel} | excluded:${failsExcludes(fullText)} | flair:${flair} | "${fullText.slice(0, 90)}"`);
  }
  if (!passes) return 0;

  const lead = buildLeadRecord(author, fullText, post.permalink, subredditLabel, trigger, "POST", flair, post.created_utc);
  if (await writeLeadNow(lead)) { writtenUsers.add(authorKey); return 1; }
  return 0;
}

// ---------- Live mode ----------
async function scrapeSubredditPosts(sub, contactedUsers, writtenUsers) {
  let count = 0;
  try {
    const posts = await reddit.getSubreddit(sub).getNew({ limit: 75 });
    for (const post of posts) count += await considerPost(post, sub, "subreddit_scan", contactedUsers, writtenUsers);
  } catch (err) { log("ERROR", `r/${sub} posts failed: ${err.message}`); }
  return count;
}

async function scrapeSubredditComments(sub, contactedUsers, writtenUsers) {
  let count = 0;
  try {
    const comments = await reddit.getSubreddit(sub).getNewComments({ limit: 100 });
    for (const comment of comments) {
      const key = `c_${comment.id}`;
      if (seenPostKeys.has(key)) continue;
      markSeen(key);
      const author = comment.author && comment.author.name;
      if (!author || author === "[deleted]" || author === "AutoModerator") continue;
      const authorKey = author.toLowerCase();
      if (contactedUsers.has(authorKey) || writtenUsers.has(authorKey)) continue;
      if (!comment.body) continue;
      const fullText = comment.body;
      const vertical = detectVertical(fullText, sub);
      if (!qualifiesComment(fullText, vertical)) continue;
      const lead = buildLeadRecord(author, fullText, comment.permalink, sub, "comment_scan", "COMMENT", "NEUTRAL", comment.created_utc);
      if (await writeLeadNow(lead)) { writtenUsers.add(authorKey); count++; }
    }
  } catch (err) { log("ERROR", `r/${sub} comments failed: ${err.message}`); }
  return count;
}

async function globalSearch(query, contactedUsers, writtenUsers) {
  let count = 0;
  try {
    const results = await reddit.search({ query, sort: "new", time: "week", limit: 50 });
    for (const post of results) {
      const label = (post.subreddit && post.subreddit.display_name) || "unknown";
      if (!ALLOWED_SUBREDDITS.has(label.toLowerCase())) continue;
      count += await considerPost(post, label, query, contactedUsers, writtenUsers);
    }
  } catch (err) { log("ERROR", `Search "${query}" failed: ${err.message}`); }
  return count;
}

async function runScrapeCycle() {
  log("INFO", "Live scrape cycle starting...");
  const contactedUsers = loadContactedUsernames();
  const writtenUsers = new Set();
  let total = 0;
  for (const sub of SUBREDDITS) { total += await scrapeSubredditPosts(sub, contactedUsers, writtenUsers); await sleep(1500); }
  for (const sub of TRADING_SUBS) { total += await scrapeSubredditComments(sub, contactedUsers, writtenUsers); await sleep(1500); }
  for (const q of LIVE_QUERIES) { total += await globalSearch(q, contactedUsers, writtenUsers); await sleep(1200); }
  saveSeenKeys(); sinceLastSave = 0;
  log("INFO", `Cycle complete — ${total} lead(s) written.`);
  if (seenPostKeys.size > 200000) {
    seenPostKeys = new Set([...seenPostKeys].slice(-120000));
    saveSeenKeys();
  }
}

// ---------- Backfill mode ----------
// Reddit won't page a single listing past roughly 1000 items, so depth comes
// from breadth: every sub crossed with every query crossed with three sorts,
// each returning a different slice of the same 180 days.
async function backfillSubreddit(sub, contactedUsers, writtenUsers) {
  let count = 0;
  const subreddit = reddit.getSubreddit(sub);

  try {
    const recent = await subreddit.getNew({ limit: 300 });
    for (const post of recent) count += await considerPost(post, sub, "backfill_new", contactedUsers, writtenUsers);
  } catch (err) { log("ERROR", `r/${sub} getNew failed: ${err.message}`); }
  await sleep(1200);

  for (const query of BACKFILL_QUERIES) {
    for (const sort of BACKFILL_SORTS) {
      try {
        const results = await subreddit.search({ query, sort, time: "year", limit: 100, restrictSr: true, syntax: "lucene" });
        for (const post of results) count += await considerPost(post, sub, `backfill:${query}`, contactedUsers, writtenUsers);
      } catch (err) {
        log("ERROR", `r/${sub} search "${query}" (${sort}) failed: ${err.message}`);
      }
      await sleep(1200);
    }
  }
  log("INFO", `r/${sub} backfill done — ${count} lead(s).`);
  return count;
}

async function runBackfill() {
  const started = Date.now();
  log("INFO", `BACKFILL starting — ${SUBREDDITS.length} subs x ${BACKFILL_QUERIES.length} queries x ${BACKFILL_SORTS.length} sorts.`);
  log("INFO", `Age caps: ${MAX_AGE_DAYS_PAIN}d for intent/pain posts, ${MAX_AGE_DAYS_HIRING}d for hiring posts.`);
  log("INFO", "This takes a few hours. Leave it running, it writes each lead as it finds it.");
  const contactedUsers = loadContactedUsernames();
  const writtenUsers = new Set();
  let total = 0;
  for (const sub of SUBREDDITS) {
    total += await backfillSubreddit(sub, contactedUsers, writtenUsers);
    saveSeenKeys();
  }
  saveSeenKeys();
  const mins = Math.round((Date.now() - started) / 60000);
  log("INFO", `BACKFILL COMPLETE — ${total} lead(s) written in ${mins} min. Now run: node scraper.cjs`);
}

// ---------- Entry ----------
(async () => {
  console.log(`ClientMagnet Scraper v9 — ${BACKFILL ? "BACKFILL (one-time historical harvest)" : "live mode"}`);
  console.log(`Subs: ${SUBREDDITS.length} | trading ${TRADING_SUBS.length}, hiring ${HIRING_SUBS.length}, owners ${OWNER_SUBS.length}`);
  if (BACKFILL) { await runBackfill(); return; }
  while (true) {
    await runScrapeCycle();
    log("INFO", `Next scrape in ${SCRAPE_INTERVAL_MS / 60000} minutes.`);
    await sleep(SCRAPE_INTERVAL_MS);
  }
})();
