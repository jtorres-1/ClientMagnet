// scraper.cjs — ClientMagnet Lead Scraper (v2.1 — incremental writes)
// Targets: e-commerce operators, local service businesses, property management.
//
// NEW IN THIS VERSION:
// - Leads are now written to CSV the instant they're found, not batched
//   until the end of a full cycle. Tonight's cycles kept getting cut
//   short by restarts and 503-triggered slowdowns, and every lead found
//   before the cycle finished was silently lost. Now nothing is lost to
//   a crash or restart, at most the lead being scanned at that exact
//   moment.
// - seenPostKeys now persists to disk (seen_keys.json) and loads back
//   on startup, instead of living only in memory. Previously every
//   restart forgot everything it had already seen, causing the same
//   post to be rediscovered and reprocessed after every restart.
// - Everything else (money-signal requirement, pain-phrase gate,
//   vertical detection, comment scanning, subreddit/query lists) is
//   unchanged from the niche-pivot rebuild.

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
const seenKeysPath = path.join(baseDir, "seen_keys.json");

const SCRAPE_INTERVAL_MS = 30 * 60 * 1000;
const SEEN_KEYS_SAVE_EVERY = 10; // persist to disk every N new keys added

const csvHeader = [
  { id: "time",           title: "Time" },
  { id: "username",       title: "Username" },
  { id: "title",          title: "Title" },
  { id: "url",            title: "URL" },
  { id: "subreddit",      title: "Subreddit" },
  { id: "vertical",       title: "Vertical" },
  { id: "leadType",       title: "Lead Type" },
  { id: "matchedTrigger", title: "Matched Trigger" },
  { id: "budget",         title: "Budget" },
  { id: "score",          title: "Score" },
  { id: "moneySignal",    title: "Money Signal" },
  { id: "painPhrase",     title: "Pain Phrase" },
  { id: "selftext",       title: "Selftext" },
];

// append:true only works correctly if the file already exists with the
// right header. If it doesn't exist yet, write the header first so the
// very first incremental append lands on a clean file.
if (!fs.existsSync(leadsPath)) {
  const headerOnlyWriter = createObjectCsvWriter({ path: leadsPath, header: csvHeader, append: false });
  headerOnlyWriter.writeRecords([]).catch(() => {});
}
const leadsWriter = createObjectCsvWriter({ path: leadsPath, header: csvHeader, append: true });

function log(tag, msg) { console.log(`[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── SEEN-POST PERSISTENCE ──────────────────────────────────────────────────
let seenPostKeys = new Set();
let sinceLastSave = 0;

function loadSeenKeys() {
  if (!fs.existsSync(seenKeysPath)) return new Set();
  try {
    const arr = JSON.parse(fs.readFileSync(seenKeysPath, "utf8"));
    return new Set(arr);
  } catch { return new Set(); }
}

function saveSeenKeys() {
  try {
    fs.writeFileSync(seenKeysPath, JSON.stringify([...seenPostKeys]));
  } catch (err) {
    log("WARN", `Failed to save seen_keys.json: ${err.message}`);
  }
}

function markSeen(key) {
  seenPostKeys.add(key);
  sinceLastSave++;
  if (sinceLastSave >= SEEN_KEYS_SAVE_EVERY) {
    saveSeenKeys();
    sinceLastSave = 0;
  }
}

seenPostKeys = loadSeenKeys();
log("INFO", `Loaded ${seenPostKeys.size} previously-seen post/comment keys from disk.`);

function loadContactedUsernames() {
  if (!fs.existsSync(usersPath)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(usersPath, "utf8"));
    return new Set(Object.keys(data));
  } catch { return new Set(); }
}

// ─── TAG FILTER ─────────────────────────────────────────────────────────────
function checkTagFilter(post) {
  const flair = (post.link_flair_text || "").toLowerCase();
  const title = (post.title || "").toLowerCase();
  if (flair && /for.?hire/.test(flair)) return "REJECT";
  if (/\[for ?hire\]|\[offer\]|\[services\]|\[available\]|\[freelancer\]/i.test(title)) return "REJECT";
  return "NEUTRAL";
}

// ─── MONEY SIGNAL (negation-aware, hard requirement) ───────────────────────────
function hasMoneySignal(text) {
  const moneyRegex = /\$[\d,]+k?|\d+k?\s*(?:usd|dollars)|budget of|paying \$|willing to pay|flat fee|would pay|i'?d pay|pay someone|pay for|pay to have/i;
  const match = text.match(moneyRegex);
  if (!match) return false;
  const before = text.slice(Math.max(0, match.index - 25), match.index);
  if (/\b(no|not|n't|zero|without|can'?t afford|unpaid|lacking)\b/i.test(before)) return false;
  return true;
}

// ─── FIRST-PERSON OPERATIONAL PAIN (the real qualification gate) ──────────────
const painPhraseRegex = /\bi(?:'m| am)?\s*(?:keep|constantly|manually|spending|wasting|losing|struggling|falling behind|drowning in|tired of|sick of)\b[^.!?]{0,80}\b(manually|by hand|myself|every (day|week|time))\b|\bwish there was\b|\bis there a tool\b|\bis there an app (for|that)\b|\bis there a way to automate\b|\bneed (a |to )?automate\b|\bneed help (managing|tracking|keeping up with)\b|\btakes (me )?(hours|forever|too long)\b|\blosing (sales|customers|money) because\b|\bcan'?t keep up with\b|\bfalling behind on\b|\bno time to keep up with\b|\bjuggling too many\b/i;

function extractPainPhrase(text) {
  const m = text.match(painPhraseRegex);
  return m ? m[0].slice(0, 80) : "";
}

const ownBuildExcludeRegex = /\bi(?:'m| am)\s+(?:currently\s+)?(?:building|developing|creating|coding|making|launching)\b|\bi built\b|\bi've built\b|\bavailable for hire\b|\bmy services\b|\bhire me\b|\bdm me for rates\b|\bcheck out my\b|\bi specialize\b|\bfreelancer here\b/i;

const noCashCompRegex = /\b(equity only|revenue share|rev share|no upfront (pay|payment|cash)|unpaid but)\b/i;

// ─── VERTICAL DETECTION ─────────────────────────────────────────────────────────
const ecommerceVerticalRegex = /\b(amazon|fba|etsy|shopify|inventory|listings?|repricing|product reviews?)\b/i;
const localServiceVerticalRegex = /\b(hvac|plumb(ing|er)?|landscap(ing|er)?|clean(ing)? (business|company)|handyman|contractor|job site|scheduling|appointments|invoic(e|ing)|customers?)\b/i;
const propertyVerticalRegex = /\b(tenant|lease|rent(al)?|property (management|manager)|landlord|maintenance request|units?\b)/i;

function detectVertical(text) {
  if (ecommerceVerticalRegex.test(text)) return "ecommerce";
  if (propertyVerticalRegex.test(text)) return "property_mgmt";
  if (localServiceVerticalRegex.test(text)) return "local_service";
  return "general";
}

const SUBREDDITS = [
  "FulfillmentByAmazon", "AmazonFBA", "Etsy", "EtsySellers", "shopify",
  "ecommerce", "dropship", "dropshipping",
  "smallbusiness", "Entrepreneur", "HVAC", "Plumbing", "landscaping",
  "cleaningbusiness", "Contractor", "Construction", "handyman",
  "PropertyManagement", "realestateinvesting", "Landlord", "RealEstate",
];

const QUERIES = [
  "keep manually", "takes me hours", "spending too much time",
  "wish there was a tool", "manually updating", "manually tracking",
  "losing sales because", "can't keep up with", "need to automate this",
  "is there a way to automate", "tired of doing this manually",
  "would pay someone to automate", "need help managing", "falling behind on",
  "juggling too many", "no time to keep up with", "is there an app for",
  "wasting hours on", "drowning in", "sick of doing this by hand",
];

function extractBudget(text) {
  const m = text.match(/\$[\d,]+(?:k)?(?:\/(?:hr|hour|mo|month))?|\d+(?:\.\d+)?(?:k)?\s*(?:dollars|usd|budget)/i);
  return m ? m[0] : "";
}

function scoreLead(text, vertical) {
  let score = 50;
  if (vertical !== "general") score += 30;
  if (/urgent|asap|immediately|right away|today|tonight/.test(text)) score += 15;
  if (/\$[\d,]+k?|\d+k?\s*(?:usd|dollars)/.test(text)) score += 25;
  if (/employees|team|staff|our (store|shop|company)/.test(text)) score += 15;
  return score;
}

function qualifies(fullText) {
  if (!painPhraseRegex.test(fullText)) return false;
  if (ownBuildExcludeRegex.test(fullText)) return false;
  if (noCashCompRegex.test(fullText)) return false;
  if (!hasMoneySignal(fullText)) return false;
  return true;
}

function buildLeadRecord(author, fullText, permalink, subredditLabel, trigger, leadType) {
  const vertical = detectVertical(fullText);
  const score = scoreLead(fullText, vertical);
  const painPhrase = extractPainPhrase(fullText);
  return {
    time: new Date().toISOString(), username: author,
    title: fullText.slice(0, 150), url: `https://reddit.com${permalink}`,
    subreddit: subredditLabel, vertical, leadType,
    matchedTrigger: trigger, budget: extractBudget(fullText), score,
    moneySignal: "YES", painPhrase,
    selftext: fullText.slice(0, 500),
  };
}

// Writes a single lead immediately. Returns true if written successfully.
async function writeLeadNow(lead) {
  try {
    await leadsWriter.writeRecords([lead]);
    log("LEAD", `[${lead.vertical.toUpperCase()}] u/${lead.username} in ${lead.subreddit} | score:${lead.score} | ${lead.title.slice(0, 70)}`);
    return true;
  } catch (err) {
    log("ERROR", `Failed to write lead for u/${lead.username}: ${err.message}`);
    return false;
  }
}

// ─── SCRAPE POSTS ───────────────────────────────────────────────────────────────
async function scrapeSubredditPosts(subredditName, contactedUsers) {
  let count = 0;
  try {
    const posts = await reddit.getSubreddit(subredditName).getNew({ limit: 50 });
    for (const post of posts) {
      const key = `p_${post.id}`;
      if (seenPostKeys.has(key)) continue;
      markSeen(key);

      const author = post.author?.name;
      if (!author || author === "[deleted]" || author === "AutoModerator") continue;
      if (contactedUsers.has(author.toLowerCase())) continue;
      if (checkTagFilter(post) === "REJECT") continue;

      const fullText = `${post.title} ${post.selftext || ""}`;
      if (!qualifies(fullText)) continue;

      const lead = buildLeadRecord(author, fullText, post.permalink, subredditName, "subreddit_scan", "POST");
      if (await writeLeadNow(lead)) count++;
    }
  } catch (err) {
    log("ERROR", `r/${subredditName} posts failed: ${err.message}`);
  }
  return count;
}

// ─── SCRAPE COMMENTS ─────────────────────────────────────────────────────────────
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
      if (!comment.body || comment.body.length < 20) continue;

      const fullText = comment.body;
      if (!qualifies(fullText)) continue;

      const lead = buildLeadRecord(author, fullText, comment.permalink, subredditName, "comment_scan", "COMMENT");
      if (await writeLeadNow(lead)) count++;
    }
  } catch (err) {
    log("ERROR", `r/${subredditName} comments failed: ${err.message}`);
  }
  return count;
}

// ─── GLOBAL SEARCH ────────────────────────────────────────────────────────────
async function globalSearch(query, contactedUsers) {
  let count = 0;
  try {
    const results = await reddit.search({ query, sort: "new", time: "week", limit: 25 });
    for (const post of results) {
      const key = `p_${post.id}`;
      if (seenPostKeys.has(key)) continue;
      markSeen(key);

      const author = post.author?.name;
      if (!author || author === "[deleted]" || author === "AutoModerator") continue;
      if (contactedUsers.has(author.toLowerCase())) continue;
      if (checkTagFilter(post) === "REJECT") continue;

      const fullText = `${post.title} ${post.selftext || ""}`;
      if (!qualifies(fullText)) continue;

      const subredditLabel = post.subreddit?.display_name || "unknown";
      const lead = buildLeadRecord(author, fullText, post.permalink, subredditLabel, query, "POST");
      if (await writeLeadNow(lead)) count++;
    }
  } catch (err) {
    log("ERROR", `Search "${query}" failed: ${err.message}`);
  }
  return count;
}

// ─── MAIN CYCLE ────────────────────────────────────────────────────────────────
async function runScrapeCycle() {
  log("INFO", "Scrape cycle starting...");
  const contactedUsers = loadContactedUsernames();
  let totalWritten = 0;

  for (const sub of SUBREDDITS) {
    totalWritten += await scrapeSubredditPosts(sub, contactedUsers);
    await sleep(3000);
  }
  for (const sub of SUBREDDITS) {
    totalWritten += await scrapeSubredditComments(sub, contactedUsers);
    await sleep(3000);
  }
  for (const query of QUERIES) {
    totalWritten += await globalSearch(query, contactedUsers);
    await sleep(2500);
  }

  // Always save at the end of a cycle too, even if under the batch threshold.
  saveSeenKeys();
  sinceLastSave = 0;

  log("INFO", `Cycle complete — ${totalWritten} lead(s) written this cycle (written incrementally as found).`);

  if (seenPostKeys.size > 20000) {
    log("INFO", `Trimming seenPostKeys (was ${seenPostKeys.size} entries).`);
    seenPostKeys = new Set([...seenPostKeys].slice(-10000));
    saveSeenKeys();
  }
}

(async () => {
  console.log("=".repeat(60));
  console.log("ClientMagnet Scraper v2.1 — incremental writes + persisted dedup");
  console.log("=".repeat(60));
  while (true) {
    await runScrapeCycle();
    log("INFO", `Next scrape in ${SCRAPE_INTERVAL_MS / 60000} minutes.`);
    await sleep(SCRAPE_INTERVAL_MS);
  }
})();
