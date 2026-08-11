// scraper.cjs — ClientMagnet Lead Scraper (v3.3 — hiring intent precision fixes)
// Targets: ecommerce operators, local service businesses, property management.
//
// v3.3 changes:
// - Dropped bare "hire" from hiringIntentRegex. It matched regardless of
//   word order, so "developer for hire" (a freelancer's own self-promo)
//   qualified just as easily as "hiring a developer" (a real employer).
//   Kept only "hiring," which is reliably employer-direction.
// - Added forHireExcludeRegex, catches "for hire" anywhere in the text
//   ("developer for hire," "web dev for hire"), not just the one exact
//   phrase "available for hire" the old exclude covered.
// - Expanded findClientsExcludeRegex to also catch "searching for clients"
//   and "looking for work," same directional risk as the hire fix, a
//   freelancer hunting for clients was matching the same "looking for" /
//   "searching for" patterns meant to catch employers.
// - Added careerChangeExcludeRegex for "want to become a developer" /
//   "wanted to be a programmer," someone discussing a career path, not
//   hiring anyone.
// - Comments now require a vertical match even for hiring-intent language,
//   not just posts. A bare comment has no surrounding post context, so
//   "yeah I hired a developer for that" (a memory, not a lead) needs the
//   extra vertical check that posts get more context to skip.
// - globalSearch time window tightened from "week" to "day," a lead from
//   six days ago has likely already found someone or moved on.
// - Added MIN_BODY_LENGTH, a one-line post with nothing else gives no real
//   context for a DM and no way to judge if it's serious.

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

const SCRAPE_INTERVAL_MS = 20 * 60 * 1000;
const SEEN_KEYS_SAVE_EVERY = 10;
const MIN_BODY_LENGTH = 40;

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

if (!fs.existsSync(leadsPath)) {
  const headerLine = csvHeader.map(h => h.title).join(",") + "\n";
  fs.writeFileSync(leadsPath, headerLine);
}
const leadsWriter = createObjectCsvWriter({ path: leadsPath, header: csvHeader, append: true });

function log(tag, msg) { console.log(`[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

let seenPostKeys = new Set();
let sinceLastSave = 0;

function loadSeenKeys() {
  if (!fs.existsSync(seenKeysPath)) return new Set();
  try { return new Set(JSON.parse(fs.readFileSync(seenKeysPath, "utf8"))); }
  catch { return new Set(); }
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
  try { return new Set(Object.keys(JSON.parse(fs.readFileSync(usersPath, "utf8")))); }
  catch { return new Set(); }
}

function checkTagFilter(post) {
  const flair = (post.link_flair_text || "").toLowerCase();
  const title = (post.title || "").toLowerCase();
  if (flair && /for.?hire/.test(flair)) return "REJECT";
  if (/\[for ?hire\]|\[offer\]|\[services\]|\[available\]|\[freelancer\]/i.test(title)) return "REJECT";
  return "NEUTRAL";
}

function hasMoneySignal(text) {
  const moneyRegex = /\$[\d,]+k?|\d+k?\s*(?:usd|dollars)|budget of|paying \$|willing to pay|flat fee|would pay|i'?d pay|pay someone|pay for|pay to have/i;
  const match = text.match(moneyRegex);
  if (!match) return false;
  const before = text.slice(Math.max(0, match.index - 25), match.index);
  if (/\b(no|not|n't|zero|without|can'?t afford|unpaid|lacking)\b/i.test(before)) return false;
  return true;
}

const painPhraseRegex = /\bi(?:'m| am)?\s*(?:keep|constantly|manually|spending|wasting|losing|struggling|falling behind|drowning in|tired of|sick of)\b[^.!?]{0,80}\b(manually|by hand|myself|every (day|week|time))\b|\bwish there was\b|\bis there a tool\b|\bis there an app (for|that)\b|\bis there a way to automate\b|\bneed (a |to )?automate\b|\bneed help (managing|tracking|keeping up with)\b|\btakes (me )?(hours|forever|too long)\b|\blosing (sales|customers|money) because\b|\bcan'?t keep up with\b|\bfalling behind on\b|\bno time to keep up with\b|\bjuggling too many\b/i;

// Employer-direction only. Bare "hire" matched regardless of word order,
// so "developer for hire" (freelancer self-promo) qualified the same as
// "hiring a developer" (real employer). "hiring" is reliably one-directional.
const hiringIntentRegex = /\b(hiring|looking for|in search of|searching for|need|want|wanted)\b[\s\w]{0,20}\b(developer|dev|programmer|coder|engineer|freelancer|automation (expert|specialist)?)\b|\bany recommendations for\b|\bcan anyone (build|make|create)\b|\bwho can build\b|\blooking to (hire|automate|build)\b|\bneed (an|a) app (built|made)\b|\bneed custom (software|tool|script|bot)\b|\bneed (a |someone to )?(build|create|develop|code)\b/i;

function extractPainPhrase(text) {
  const m = text.match(painPhraseRegex) || text.match(hiringIntentRegex);
  return m ? m[0].slice(0, 80) : "";
}

const ownBuildExcludeRegex = /\bi(?:'m| am)\s+(?:currently\s+)?(?:building|developing|creating|coding|making|launching)\b|\bi built\b|\bi've built\b|\bbuilt (a|an|my)\b|\bshipped (a|an|my)\b|\blaunched (a|an|my)\b|\bi told an ai\b|\bavailable for hire\b|\bmy services\b|\bhire me\b|\bdm me for rates\b|\bcheck out my\b|\bi specialize\b|\bfreelancer here\b/i;

const noCashCompRegex = /\b(equity only|revenue share|rev share|no upfront (pay|payment|cash)|unpaid but)\b/i;

const coFounderExcludeRegex = /\b(co-?founder|technical co-?founder|equity[- ]based|equity only|founding (engineer|builder)|join (my|our) startup as)\b/i;

const offeringHelpExcludeRegex = /\b(i want to help|reaching out to offer|here to help (small )?business owners|happy to help you|dm me if you (need|want) help|i offer|i provide services|check out my agency|our agency helps)\b/i;

// Catches "developer for hire," "web dev for hire," any "for hire" phrasing,
// not just the one exact string "available for hire" the old exclude caught.
const forHireExcludeRegex = /\bfor\s+hire\b/i;

// Expanded to catch the freelancer-direction version of "looking for" /
// "searching for" that hiringIntentRegex can't tell apart from an employer.
const findClientsExcludeRegex = /\bfind clients\b|\bget clients\b|\bland clients\b|\bhow (do|can) i get clients\b|\bclient acquisition\b|\bsearching for clients\b|\blooking for (new )?clients\b|\blooking for work\b|\bsearching for work\b|\blooking for (freelance |contract )?(gigs|projects)\b/i;

// "want to become a developer" / "wanted to be a programmer" is a career
// question, not a hiring post, but matches the same want/wanted pattern.
const careerChangeExcludeRegex = /\bwant(ed)? to (become|be|learn to be)\b[\s\w]{0,15}\b(developer|dev|programmer|coder|engineer)\b/i;

const ecommerceVerticalRegex = /\b(amazon|fba|etsy|shopify|inventory|listings?|repricing|product reviews?|dropship(ping)?|print on demand)\b/i;
const localServiceVerticalRegex = /\b(hvac|plumb(ing|er)?|landscap(ing|er)?|clean(ing)? (business|company)|handyman|contractor|job site|scheduling|appointments|invoic(e|ing)|electrician|roofing|pest control|auto repair|locksmith)\b/i;
const propertyVerticalRegex = /\b(tenant|lease|rent(al)?|property (management|manager)|landlord|maintenance request|units?\b)/i;

function detectVertical(text) {
  if (ecommerceVerticalRegex.test(text)) return "ecommerce";
  if (propertyVerticalRegex.test(text)) return "property_mgmt";
  if (localServiceVerticalRegex.test(text)) return "local_service";
  return "general";
}

const SUBREDDITS = [
  "FulfillmentByAmazon", "AmazonFBA", "amazonseller", "AmazonSellerCentral",
  "Etsy", "EtsySellers", "shopify", "ecommerce", "dropship", "dropshipping",
  "printondemand", "EcommerceMarketing", "woocommerce", "FacebookAds", "PPC",
  "Flipping", "juststart",
  "sweatystartup", "smallbusiness", "Entrepreneur", "EntrepreneurRideAlong",
  "startups", "HVAC", "Plumbing", "landscaping", "cleaningbusiness",
  "Contractor", "Construction", "handyman", "Carpentry", "Electricians",
  "Roofing", "PestControl", "Locksmith", "autorepair", "HomeImprovement",
  "smallbusinessowner", "junkremoval",
  "PropertyManagement", "realestateinvesting", "Landlord", "RealEstate",
  "LandlordLove", "Airbnb", "realestateinvestor",
  "forhire", "slavelabour", "smallbusinessowners",
];

const ALLOWED_SUBREDDITS = new Set(SUBREDDITS.map(s => s.toLowerCase()));

const QUERIES = [
  "keep manually", "takes me hours", "spending too much time",
  "wish there was a tool", "manually updating", "manually tracking",
  "losing sales because", "can't keep up with", "need to automate this",
  "is there a way to automate", "tired of doing this manually",
  "would pay someone to automate", "need help managing", "falling behind on",
  "juggling too many", "no time to keep up with", "is there an app for",
  "wasting hours on", "drowning in", "sick of doing this by hand",
  "looking for a developer", "hiring a developer", "need someone to build",
  "any recommendations for a tool", "can anyone build", "need custom software",
  "need an app built", "who can build me", "looking to automate",
  "need a script for", "need a programmer", "looking for a web developer",
];

function extractBudget(text) {
  const m = text.match(/\$[\d,]+(?:k)?(?:\/(?:hr|hour|mo|month))?|\d+(?:\.\d+)?(?:k)?\s*(?:dollars|usd|budget)/i);
  return m ? m[0] : "";
}

function failsExcludes(fullText) {
  if (ownBuildExcludeRegex.test(fullText)) return true;
  if (noCashCompRegex.test(fullText)) return true;
  if (coFounderExcludeRegex.test(fullText)) return true;
  if (offeringHelpExcludeRegex.test(fullText)) return true;
  if (findClientsExcludeRegex.test(fullText)) return true;
  if (forHireExcludeRegex.test(fullText)) return true;
  if (careerChangeExcludeRegex.test(fullText)) return true;
  return false;
}

// Posts: hiring-intent language qualifies on its own, pain language needs a
// vertical match. Comments: no surrounding post context, so even hiring
// intent needs a vertical match too, a bare comment mentioning hiring is
// more likely a memory or aside than a real lead.
function qualifiesPost(fullText, vertical) {
  if (fullText.length < MIN_BODY_LENGTH) return false;
  if (failsExcludes(fullText)) return false;
  if (hiringIntentRegex.test(fullText)) return true;
  if (vertical !== "general" && painPhraseRegex.test(fullText)) return true;
  return false;
}

function qualifiesComment(fullText, vertical) {
  if (fullText.length < MIN_BODY_LENGTH) return false;
  if (failsExcludes(fullText)) return false;
  if (vertical === "general") return false;
  return hiringIntentRegex.test(fullText) || painPhraseRegex.test(fullText);
}

function buildLeadRecord(author, fullText, permalink, subredditLabel, trigger, leadType) {
  const vertical = detectVertical(fullText);
  const painPhrase = extractPainPhrase(fullText);
  return {
    time: new Date().toISOString(), username: author,
    title: fullText.slice(0, 150), url: `https://reddit.com${permalink}`,
    subreddit: subredditLabel, vertical, leadType,
    matchedTrigger: trigger, budget: extractBudget(fullText),
    score: hasMoneySignal(fullText) ? 90 : 70,
    moneySignal: hasMoneySignal(fullText) ? "YES" : "NO",
    painPhrase, selftext: fullText.slice(0, 500),
  };
}

async function writeLeadNow(lead) {
  try {
    await leadsWriter.writeRecords([lead]);
    log("LEAD", `[${lead.vertical.toUpperCase()}] u/${lead.username} in ${lead.subreddit} | ${lead.title.slice(0, 70)}`);
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
      if (checkTagFilter(post) === "REJECT") continue;
      const fullText = `${post.title} ${post.selftext || ""}`;
      const vertical = detectVertical(fullText);
      if (!qualifiesPost(fullText, vertical)) continue;
      const lead = buildLeadRecord(author, fullText, post.permalink, subredditName, "subreddit_scan", "POST");
      if (await writeLeadNow(lead)) count++;
    }
  } catch (err) {
    log("ERROR", `r/${subredditName} posts failed: ${err.message}`);
  }
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
      if (!qualifiesComment(fullText, vertical)) continue;
      const lead = buildLeadRecord(author, fullText, comment.permalink, subredditName, "comment_scan", "COMMENT");
      if (await writeLeadNow(lead)) count++;
    }
  } catch (err) {
    log("ERROR", `r/${subredditName} comments failed: ${err.message}`);
  }
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
      if (checkTagFilter(post) === "REJECT") continue;
      const fullText = `${post.title} ${post.selftext || ""}`;
      const vertical = detectVertical(fullText);
      if (!qualifiesPost(fullText, vertical)) continue;
      const lead = buildLeadRecord(author, fullText, post.permalink, subredditLabel, query, "POST");
      if (await writeLeadNow(lead)) count++;
    }
  } catch (err) {
    log("ERROR", `Search "${query}" failed: ${err.message}`);
  }
  return count;
}

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

  saveSeenKeys();
  sinceLastSave = 0;
  log("INFO", `Cycle complete — ${totalWritten} lead(s) written this cycle.`);

  if (seenPostKeys.size > 30000) {
    seenPostKeys = new Set([...seenPostKeys].slice(-15000));
    saveSeenKeys();
  }
}

(async () => {
  console.log("ClientMagnet Scraper v3.3 — hiring intent precision fixes");
  while (true) {
    await runScrapeCycle();
    log("INFO", `Next scrape in ${SCRAPE_INTERVAL_MS / 60000} minutes.`);
    await sleep(SCRAPE_INTERVAL_MS);
  }
})();
