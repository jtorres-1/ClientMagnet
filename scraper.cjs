// scraper.cjs — ClientMagnet Scraper v10 (every active trader in ICP subs)
//
// v10, Oct 28. Keyword qualification is gone. Every poster and commenter in
// the trading subs is a lead, minus bot makers, mods, and anyone already
// contacted. The DM bot qualifies them in the conversation instead.
//
//   node scraper.cjs              live loop: new posts + new comments every 10 min
//   node scraper.cjs --backfill   one pass over the last month of top/hot threads

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

const baseDir = path.resolve(__dirname, "logs");
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
const leadsPath    = path.join(baseDir, "clean_leads.csv");
const usersPath    = path.join(baseDir, "contacted_users.json");
const seenKeysPath = path.join(baseDir, "seen_keys.json");
const vendorsPath  = path.join(baseDir, "vendors.json");

const SCRAPE_INTERVAL_MS = 10 * 60 * 1000;
const MAX_AGE_DAYS = 30;               // inactive people don't answer DMs
const BACKFILL_COMMENT_THREADS = 40;   // per sub, busiest threads first

// ---------- Subreddits ----------
// Any that don't exist or went private get dropped at startup.
const FUTURES_SUBS = [
  "FuturesTrading", "Daytrading", "algotrading", "Trading", "TradingView",
  "Topstep", "apextraderfunding", "propfirm", "Tradeify", "ninjatrader",
  "tradovate", "FundedFutures",
];
const MT5_SUBS = ["Forex", "FTMO", "Forexstrategy", "XAUUSD", "Metatrader", "FundedNext"];
const MT5_SET = new Set(MT5_SUBS.map(s => s.toLowerCase()));

// ---------- Bot makers / sellers ----------
// Anyone who builds, sells or offers bots, EAs, signals or dev work is out.
const VENDOR_PATTERNS = [
  /\b(?:i|we) (?:build|code|develop|program|make|create|sell|offer|write)s? (?:custom |private |automated )?(?:trading )?(?:bots?|eas?|expert advisors?|algos?|indicators?|scripts?|strateg(?:y|ies)|software)\b/,
  /\bi (?:built|coded|wrote|made|developed|programmed|created) (?:a|an|my|this|our)(?: own)?(?: \w+){0,2} (?:bot|ea|expert advisor|algo|algorithm|indicator|script|system|copier)\b/,
  /\b(?:my|our) (?:bot|ea|algo|indicator|software|tool|service|signals?|course|mentorship|discord|telegram) (?:is|are) (?:available|for sale|live|now|open)\b/,
  /\bfor sale\b|\bselling (?:my|our|a|an)\b/,
  /\bdm (?:me )?for (?:access|details|price|pricing|info|the link)\b/,
  /\blink in (?:my )?bio\b|\bcheck out my\b|\bjoin (?:my|our) (?:discord|telegram|group|community)\b/,
  /\bfree (?:trial|signals)\b|\b(?:available|open) for (?:hire|commissions?|work)\b|\bhire me\b|\[for ?hire\]/,
  /\b(?:developer|dev|programmer|coder) here\b|\bi'?m an? (?:mql[45]? |pine ?script |algo |quant |freelance |software )?(?:developer|programmer|coder|dev)\b/,
  /\bi can (?:code|build|program|automate|convert) (?:it|this|that|your|any)\b/,
  /github\.com\/|whop\.com|gumroad\.com|mql5\.com\/\w+\/(?:market|signals|users)/,
];
const VENDOR_TEXT = new RegExp(VENDOR_PATTERNS.map(r => r.source).join("|"), "i");
const VENDOR_NAME = /(bot|algo|signal|labs?|studio|official|solutions|coder|developer|dev$|^dev)/i;

function log(tag, msg) { console.log(`[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function readJSON(p, fallback) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback; } catch { return fallback; }
}
const clean = s => String(s || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
function ageDaysOf(createdUtc) { return createdUtc ? Math.max(0, (Date.now() / 1000 - createdUtc) / 86400) : 0; }

// ---------- CSV ----------
const csvHeader = [
  { id: "time", title: "Time" }, { id: "username", title: "Username" },
  { id: "subreddit", title: "Subreddit" }, { id: "family", title: "Family" },
  { id: "leadType", title: "Lead Type" }, { id: "title", title: "Title" },
  { id: "snippet", title: "Snippet" }, { id: "url", title: "URL" },
  { id: "postedAt", title: "Posted At" },
];
if (fs.existsSync(leadsPath)) {
  const firstLine = fs.readFileSync(leadsPath, "utf8").split("\n")[0] || "";
  if (!firstLine.includes("Family")) {
    const archived = path.join(baseDir, `clean_leads_v9_${Date.now()}.csv`);
    fs.renameSync(leadsPath, archived);
    console.log(`Archived old-format CSV to ${path.basename(archived)}`);
  }
}
if (!fs.existsSync(leadsPath)) fs.writeFileSync(leadsPath, csvHeader.map(h => h.title).join(",") + "\n");
const leadsWriter = createObjectCsvWriter({ path: leadsPath, header: csvHeader, append: true });

// Usernames already in the CSV, so nobody gets written twice across runs.
const knownUsers = new Set(
  fs.readFileSync(leadsPath, "utf8").split("\n").slice(1)
    .map(l => (l.split(",")[1] || "").replace(/"/g, "").trim().toLowerCase()).filter(Boolean)
);

// ---------- Seen keys ----------
let seenPostKeys = new Set(readJSON(seenKeysPath, []));
let sinceLastSave = 0;
function saveSeenKeys() {
  try { fs.writeFileSync(seenKeysPath, JSON.stringify([...seenPostKeys])); }
  catch (err) { log("WARN", `seen_keys save failed: ${err.message}`); }
}
function markSeen(key) {
  seenPostKeys.add(key);
  if (++sinceLastSave >= 50) { saveSeenKeys(); sinceLastSave = 0; }
}

// ---------- Vendors ----------
const vendorSet = new Set(Object.keys(readJSON(vendorsPath, {})));
function addVendor(name, reason) {
  if (vendorSet.has(name)) return;
  vendorSet.add(name);
  const v = readJSON(vendorsPath, {});
  v[name] = { reason, at: new Date().toISOString() };
  fs.writeFileSync(vendorsPath, JSON.stringify(v));
}

function loadContacted() { return new Set(Object.keys(readJSON(usersPath, {}))); }
const modSet = new Set();

function familyFor(sub, text) {
  if (MT5_SET.has(sub.toLowerCase())) {
    return /\b(futures|nq|mnq|mes|mgc|topstep|apex|lucid|tradeify|tradovate|ninjatrader|rithmic)\b/i.test(text) ? "futures" : "mt5";
  }
  return /\b(mt[45]|metatrader|ftmo|xauusd|cfds?|forex)\b/i.test(text) ? "mt5" : "futures";
}

// ---------- Core ----------
async function consider(item, type, sub, threadTitle, ctx) {
  const key = (type === "POST" ? "p_" : "c_") + item.id;
  if (seenPostKeys.has(key)) return 0;
  markSeen(key);

  const author = item.author && item.author.name;
  if (!author || author === "[deleted]" || author === "AutoModerator") return 0;
  if (item.distinguished || item.stickied) return 0;
  const k = author.toLowerCase();
  if (ctx.contacted.has(k) || knownUsers.has(k) || vendorSet.has(k) || modSet.has(k)) return 0;
  if (VENDOR_NAME.test(author)) { addVendor(k, "username"); return 0; }
  if (ageDaysOf(item.created_utc) > MAX_AGE_DAYS) return 0;

  const text = type === "POST" ? `${item.title || ""} ${item.selftext || ""}` : (item.body || "");
  if (VENDOR_TEXT.test(text)) { addVendor(k, "text"); return 0; }

  const lead = {
    time: new Date().toISOString(),
    username: author,
    subreddit: sub,
    family: familyFor(sub, text),
    leadType: type,
    title: clean(type === "POST" ? item.title : (threadTitle || item.link_title || "")).slice(0, 140),
    snippet: clean(text).slice(0, 300),
    url: `https://reddit.com${item.permalink}`,
    postedAt: item.created_utc ? new Date(item.created_utc * 1000).toISOString() : "",
  };
  try {
    await leadsWriter.writeRecords([lead]);
    knownUsers.add(k);
    return 1;
  } catch (err) {
    log("ERROR", `write failed u/${author}: ${err.message}`);
    return 0;
  }
}

async function validateSubs(list) {
  const ok = [];
  for (const name of list) {
    try {
      const s = await reddit.getSubreddit(name).fetch();
      if (s.subreddit_type === "public" || s.subreddit_type === "restricted") {
        ok.push(s.display_name);
        log("SUB", `r/${s.display_name} ok, ${s.subscribers} members`);
        try {
          const mods = await reddit.getSubreddit(s.display_name).getModerators();
          for (const m of mods) modSet.add(String(m.name).toLowerCase());
        } catch { /* mod list hidden, fine */ }
      } else log("SKIP", `r/${name} is ${s.subreddit_type}`);
    } catch { log("SKIP", `r/${name} not available`); }
    await sleep(900);
  }
  return ok;
}

async function runCycle(subs) {
  const ctx = { contacted: loadContacted() };
  let total = 0;
  for (const sub of subs) {
    let n = 0;
    try {
      const posts = await reddit.getSubreddit(sub).getNew({ limit: 100 });
      for (const p of posts) n += await consider(p, "POST", sub, "", ctx);
    } catch (err) { log("ERROR", `r/${sub} posts: ${err.message}`); }
    await sleep(1200);
    try {
      const comments = await reddit.getSubreddit(sub).getNewComments({ limit: 100 });
      for (const c of comments) n += await consider(c, "COMMENT", sub, c.link_title, ctx);
    } catch (err) { log("ERROR", `r/${sub} comments: ${err.message}`); }
    await sleep(1200);
    if (n) log("LEADS", `r/${sub}: ${n} new`);
    total += n;
  }
  saveSeenKeys(); sinceLastSave = 0;
  log("INFO", `Cycle done, ${total} new leads, ${knownUsers.size} total in CSV, ${vendorSet.size} bot makers excluded`);
  if (seenPostKeys.size > 300000) { seenPostKeys = new Set([...seenPostKeys].slice(-150000)); saveSeenKeys(); }
}

async function walkComments(list, sub, title, ctx, depth = 0) {
  let n = 0;
  if (!list) return 0;
  for (const c of list) {
    if (!c || !c.id || c.body === undefined) continue;
    n += await consider(c, "COMMENT", sub, title, ctx);
    if (depth < 3 && c.replies && c.replies.length) n += await walkComments(c.replies, sub, title, ctx, depth + 1);
  }
  return n;
}

async function backfillSub(sub, ctx) {
  let n = 0;
  const threads = new Map();
  const listings = [
    ["top",  s => s.getTop({ time: "month", limit: 100 })],
    ["hot",  s => s.getHot({ limit: 100 })],
    ["new",  s => s.getNew({ limit: 300 })],
  ];
  for (const [label, fn] of listings) {
    try {
      const posts = await fn(reddit.getSubreddit(sub));
      for (const p of posts) {
        n += await consider(p, "POST", sub, "", ctx);
        if (p.num_comments > 0 && ageDaysOf(p.created_utc) <= MAX_AGE_DAYS) threads.set(p.id, p);
      }
    } catch (err) { log("ERROR", `r/${sub} ${label}: ${err.message}`); }
    await sleep(1200);
  }
  const busiest = [...threads.values()].sort((a, b) => b.num_comments - a.num_comments).slice(0, BACKFILL_COMMENT_THREADS);
  for (const p of busiest) {
    try {
      const full = await reddit.getSubmission(p.id).fetch();
      n += await walkComments(full.comments, sub, p.title, ctx);
    } catch (err) { log("ERROR", `thread ${p.id}: ${err.message}`); }
    await sleep(1200);
  }
  saveSeenKeys();
  log("BACKFILL", `r/${sub} done, ${n} leads`);
  return n;
}

(async () => {
  console.log(`ClientMagnet Scraper v10 — ${BACKFILL ? "BACKFILL" : "live"} — every active trader, no keyword filter`);
  const subs = await validateSubs([...FUTURES_SUBS, ...MT5_SUBS]);
  if (!subs.length) { log("FATAL", "No subreddits available"); process.exit(1); }
  log("INFO", `${subs.length} subs live, ${modSet.size} mods excluded, ${knownUsers.size} users already in CSV`);

  if (BACKFILL) {
    const ctx = { contacted: loadContacted() };
    let total = 0;
    for (const sub of subs) total += await backfillSub(sub, ctx);
    log("BACKFILL", `COMPLETE, ${total} leads written`);
    return;
  }
  while (true) {
    await runCycle(subs);
    await sleep(SCRAPE_INTERVAL_MS);
  }
})();
