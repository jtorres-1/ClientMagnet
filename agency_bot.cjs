// agency_bot.cjs — ClientMagnet DM Bot v6 (DM every trader, qualify in the reply)
//
// v6, Oct 28.
//  - No score gate. Every lead the scraper writes gets a DM, newest activity first.
//  - One ICP message family: shadowtrade, TradersPost, no price, no links, ends
//    on the qualifying question (how many accounts / what size).
//  - Pre-send vet: account age, karma, and their last 30 posts/comments scanned
//    for bot maker / seller language. Vendors never get messaged.
//  - Multi-account rotation: REDDIT_USERNAME / REDDIT_USERNAME_2 ... _5, each
//    with its own warmup and daily cap. A dead account stops itself and alerts.
//  - Reply tiering: ICP (5+ accounts, 100K+, funded, group owner), MID, LOW,
//    QUESTION. Telegram alert carries the next message to send, ready to paste.
//  - Fixed: "bot" and "pass" no longer close a lead as not interested.
//  - Send window pinned to New York time, not the server clock.

require("dotenv").config();
process.env.TZ = process.env.SEND_TZ || "America/New_York";
const snoowrap = require("snoowrap");
const fs   = require("fs");
const path = require("path");
const csv  = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");

const baseDir = path.resolve(__dirname, "logs");
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
const leadsPath   = path.join(baseDir, "clean_leads.csv");
const sentPath    = path.join(baseDir, "dm_sent_v6.csv");
const usersPath   = path.join(baseDir, "contacted_users.json");
const sendLogPath = path.join(baseDir, "send_log.json");
const vendorsPath = path.join(baseDir, "vendors.json");

// ---------- Rate ----------
const PER_ACCOUNT_CAP   = parseInt(process.env.PER_ACCOUNT_CAP || "50", 10);
const WARMUP            = [15, 30, 40];       // per account, day 1/2/3
const SEND_WINDOW_START = 8;                  // New York time
const SEND_WINDOW_END   = 22;
const MIN_DELAY_MS      = 45 * 1000;
const MAX_DELAY_MS      = 12 * 60 * 1000;
const INBOX_POLL_MS     = 60 * 1000;
const MAX_LEAD_AGE_DAYS = 30;
const MIN_ACCOUNT_AGE_DAYS = 30;
const MIN_KARMA         = 20;

const TELEGRAM_TOKEN   = process.env.TELEGRAM_ALERT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_ALERT_CHAT_ID || "";

function log(tag, msg) { console.log(`[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pick  = arr => arr[Math.floor(Math.random() * arr.length)];
const esc   = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function readJSON(p, fallback) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback; } catch { return fallback; }
}

// ---------- Accounts ----------
function loadAccounts() {
  const out = [];
  for (let i = 1; i <= 5; i++) {
    const sfx = i === 1 ? "" : `_${i}`;
    const username = process.env[`REDDIT_USERNAME${sfx}`];
    const password = process.env[`REDDIT_PASSWORD${sfx}`];
    if (!username || !password) continue;
    const client = new snoowrap({
      userAgent:    process.env[`REDDIT_USER_AGENT${sfx}`] || process.env.REDDIT_USER_AGENT,
      clientId:     process.env[`REDDIT_CLIENT_ID${sfx}`] || process.env.REDDIT_CLIENT_ID,
      clientSecret: process.env[`REDDIT_CLIENT_SECRET${sfx}`] || process.env.REDDIT_CLIENT_SECRET,
      username, password,
    });
    client.config({ requestDelay: 1100, continueAfterRatelimitError: true });
    out.push({ name: username, client });
  }
  return out;
}
const ACCOUNTS = loadAccounts();
if (!ACCOUNTS.length) { console.log("No Reddit accounts in .env"); process.exit(1); }
const ACCOUNT_NAMES = new Set(ACCOUNTS.map(a => a.name.toLowerCase()));
const disabled = new Set();
const cooldownUntil = new Map();

// ---------- Telegram ----------
async function telegram(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  } catch (err) { log("WARN", `telegram failed: ${err.message}`); }
}
function disableAccount(acct, reason) {
  if (disabled.has(acct.name)) return;
  disabled.add(acct.name);
  log("ACCOUNT_DOWN", `u/${acct.name}: ${reason}`);
  telegram(`⚠️ <b>ClientMagnet account stopped</b>\nu/${esc(acct.name)}\n${esc(reason).slice(0, 300)}`);
}

// ---------- Users ----------
function loadUsers() { return readJSON(usersPath, {}); }
function saveUsers(u) { fs.writeFileSync(usersPath, JSON.stringify(u, null, 2)); }
function getUser(users, name) { return users[name.toLowerCase()] || null; }
function upsertUser(users, name, fields) {
  const k = name.toLowerCase();
  users[k] = { ...(users[k] || {}), ...fields, last_message_at: new Date().toISOString() };
  saveUsers(users);
  return users[k];
}
function markVendor(name, reason) {
  const v = readJSON(vendorsPath, {});
  v[name.toLowerCase()] = { reason, at: new Date().toISOString() };
  fs.writeFileSync(vendorsPath, JSON.stringify(v));
}

// ---------- Send log (per account, rolling 24h) ----------
function loadSendLog() {
  const d = readJSON(sendLogPath, {});
  if (Array.isArray(d.sends)) {  // v5 single-account format
    return { accounts: { [ACCOUNTS[0].name.toLowerCase()]: { firstSendAt: d.firstSendAt || null, sends: d.sends } } };
  }
  return { accounts: d.accounts || {} };
}
function acctState(d, name) {
  const k = name.toLowerCase();
  if (!d.accounts[k]) d.accounts[k] = { firstSendAt: null, sends: [] };
  return d.accounts[k];
}
function saveSendLog(d) {
  const cutoff = Date.now() - 8 * 86400000;
  for (const k of Object.keys(d.accounts)) d.accounts[k].sends = d.accounts[k].sends.filter(t => t > cutoff);
  fs.writeFileSync(sendLogPath, JSON.stringify(d));
}
const sent24 = st => st.sends.filter(t => t > Date.now() - 86400000).length;
function capFor(st) {
  if (!st.firstSendAt) return Math.min(WARMUP[0], PER_ACCOUNT_CAP);
  const days = Math.floor((Date.now() - st.firstSendAt) / 86400000);
  return Math.min(days < WARMUP.length ? WARMUP[days] : PER_ACCOUNT_CAP, PER_ACCOUNT_CAP);
}
function availableAccounts(d) {
  return ACCOUNTS.filter(a => !disabled.has(a.name) && (cooldownUntil.get(a.name) || 0) < Date.now());
}
function remainingQuota(d) {
  return availableAccounts(d).reduce((sum, a) => { const st = acctState(d, a.name); return sum + Math.max(0, capFor(st) - sent24(st)); }, 0);
}
function pickAccount(d) {
  let best = null;
  for (const a of availableAccounts(d)) {
    const st = acctState(d, a.name);
    const cap = capFor(st), sent = sent24(st);
    if (sent >= cap) continue;
    const ratio = sent / cap;
    if (!best || ratio < best.ratio) best = { a, ratio };
  }
  return best ? best.a : null;
}
function inSendWindow() { const h = new Date().getHours(); return h >= SEND_WINDOW_START && h < SEND_WINDOW_END; }
function minutesLeftInWindow() {
  const now = new Date(), end = new Date(now);
  end.setHours(SEND_WINDOW_END, 0, 0, 0);
  return Math.max(1, (end - now) / 60000);
}
function nextDelayMs(remaining) {
  if (remaining <= 0) return MAX_DELAY_MS;
  const even = (minutesLeftInWindow() / remaining) * 60000;
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, Math.round(even * (0.55 + Math.random() * 0.9))));
}

// ---------- Bot maker filter (same rules as the scraper) ----------
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
const VENDOR_SUBS = new Set(["forhire", "slavelabour", "freelance_forhire", "hireaprogrammer", "jobbit"]);

async function vetUser(username) {
  const acct = ACCOUNTS.find(a => !disabled.has(a.name));
  if (!acct) return { ok: null };
  if (VENDOR_NAME.test(username)) return { ok: false, vendor: true, reason: "vendor_username" };
  try {
    const u = await acct.client.getUser(username).fetch();
    if (u.is_suspended) return { ok: false, reason: "suspended" };
    const ageDays = (Date.now() / 1000 - (u.created_utc || 0)) / 86400;
    const karma = (u.link_karma || 0) + (u.comment_karma || 0);
    if (ageDays < MIN_ACCOUNT_AGE_DAYS) return { ok: false, reason: `new_account_${Math.round(ageDays)}d` };
    if (karma < MIN_KARMA) return { ok: false, reason: `low_karma_${karma}` };
    try {
      const bio = u.subreddit && u.subreddit.public_description;
      if (bio && VENDOR_TEXT.test(bio)) return { ok: false, vendor: true, reason: "vendor_bio" };
    } catch { /* no profile sub */ }
    const overview = await acct.client.getUser(username).getOverview({ limit: 30 });
    for (const it of overview) {
      const sub = String((it.subreddit && it.subreddit.display_name) || "").toLowerCase();
      const text = `${it.title || ""} ${it.selftext || ""} ${it.body || ""}`;
      // posting in a hiring sub is fine if they're the one hiring
      if (VENDOR_SUBS.has(sub) && !/\[hiring\]|\[task\]/i.test(it.title || "")) return { ok: false, vendor: true, reason: `vendor_sub_${sub}` };
      if (VENDOR_TEXT.test(text)) return { ok: false, vendor: true, reason: "vendor_history" };
    }
    return { ok: true };
  } catch (err) {
    if (/404|not found|USER_DOESNT_EXIST|suspended/i.test(err.message)) return { ok: false, reason: "gone" };
    log("WARN", `vet u/${username} failed: ${err.message}`);
    return { ok: null };
  }
}

// ---------- Messages ----------
// No price, no links, one question, ends on the qualifier.
const FUTURES_OPENERS = [
  { id: "F1", t: s => `hey, figured i'd ask since you're in r/${s}. i run shadowtrade, a gold and nasdaq trading bot that trades prop accounts through traderspost. how many accounts are you running right now?` },
  { id: "F2", t: s => `hey, how many accounts are you trading right now? i run shadowtrade, a futures trading bot on gold and nasdaq. it copies to all of them through traderspost so you're not stuck at the screen` },
  { id: "F3", t: s => `hey, are you trading evals or funded accounts right now? shadowtrade is my gold and nasdaq trading bot, it runs on client prop accounts through traderspost every day` },
  { id: "F4", t: s => `hey, i built shadowtrade, a trading bot for gold and nasdaq futures. traders run it across their prop accounts with traderspost. how many accounts would you put it on?` },
  { id: "F5", t: s => `hey, fellow r/${s} trader here. i run shadowtrade, it trades gold and nasdaq on prop accounts through traderspost, one signal copied to every account. how many are you running?` },
  { id: "F6", t: s => `hey, do you trade your prop accounts by hand? i run shadowtrade, a gold and nasdaq trading bot that handles all of them at once through traderspost` },
];
const FUTURES_REF = [
  { id: "FR1", t: (s, ref) => `hey, re ${ref}. i run shadowtrade, a gold and nasdaq trading bot that clients run on their prop accounts through traderspost. how many accounts do you trade?` },
  { id: "FR2", t: (s, ref) => `hey, found you through ${ref}. shadowtrade is my gold and nasdaq trading bot, it copies to every prop account at once through traderspost. how many are you running right now?` },
];
const MT5_OPENERS = [
  { id: "M1", t: s => `hey, i run shadowtrade, a gold trading bot, and i build it as an mt5 ea for ftmo and other prop accounts. what size accounts are you trading right now?` },
  { id: "M2", t: s => `hey, figured i'd ask since you're in r/${s}. i've got a gold trading bot built as an mt5 ea running on prop accounts. how many accounts are you trading?` },
  { id: "M3", t: s => `hey, are you on mt5 right now? i run shadowtrade, a gold trading bot that runs as an ea on ftmo style accounts so it trades without you watching the chart` },
  { id: "M4", t: s => `hey, do you trade gold? shadowtrade is my gold trading bot, it runs as an mt5 ea with the daily and max loss limits built in. what size account are you on` },
];
const MT5_REF = [
  { id: "MR1", t: (s, ref) => `hey, re ${ref}. i run shadowtrade, a gold trading bot that runs as an mt5 ea on prop accounts. what size account are you trading?` },
  { id: "MR2", t: (s, ref) => `hey, found you through ${ref}. i've got a gold trading bot running as an mt5 ea on ftmo style accounts. how many accounts are you trading right now?` },
];
const SUBJECTS = {
  futures: s => ["your prop accounts", "gold and nasdaq trading bot", "shadowtrade", "trading bot for your accounts", `r/${s}`],
  mt5:     s => ["mt5 gold ea", "gold trading bot", "shadowtrade", "your prop account", `r/${s}`],
};
const BANNED = [
  /\bsaw your post\b/i, /\bsaw what you said\b/i, /\bchecked out your post\b/i, /\bcame across your post\b/i,
  /\bi noticed\b/i, /\bi hope this\b/i, /\breaching out\b/i, /\bhappy to\b/i, /\bquick (one|question)\b/i,
  /\bgot it\b/i, /\bhope you'?re (well|doing)\b/i,
];
function violates(text) {
  if (BANNED.some(rx => rx.test(text))) return true;
  if ((text.match(/\?/g) || []).length > 1) return true;
  if (text.trim().split(/\s+/).length > 45) return true;
  if (/^[A-Z]/.test(text.trim())) return true;
  if (/[–—]|\s-\s|https?:\/\//.test(text)) return true;
  return false;
}
function cleanTitle(t) {
  let s = String(t || "").replace(/[?"“”]/g, "").replace(/[–—]/g, " ").replace(/\s-+\s/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const w = s.split(" ");
  if (w.length > 8) s = w.slice(0, 8).join(" ") + "...";
  return s.toLowerCase();
}
function refFor(lead) {
  const title = cleanTitle(lead.Title);
  if (!title) return "";
  return lead["Lead Type"] === "COMMENT" ? `your comment on "${title}"` : `your post "${title}"`;
}
let lastTemplate = "", lastSubject = "";
function buildMessage(lead) {
  const family = String(lead.Family || "").toLowerCase() === "mt5" ? "mt5" : "futures";
  const sub = (lead.Subreddit || "trading").trim();
  const ref = refFor(lead);
  const base = (family === "mt5" ? MT5_OPENERS : FUTURES_OPENERS).map(v => ({ id: v.id, text: v.t(sub) }));
  const refs = ref ? (family === "mt5" ? MT5_REF : FUTURES_REF).map(v => ({ id: v.id, text: v.t(sub, ref) })) : [];
  const pool = refs.length && Math.random() < 0.5 ? refs : base;
  let safe = pool.filter(v => v.id !== lastTemplate && !violates(v.text));
  if (!safe.length) safe = base.filter(v => v.id !== lastTemplate && !violates(v.text));
  if (!safe.length) return null;
  const chosen = pick(safe);
  lastTemplate = chosen.id;
  const subjects = SUBJECTS[family](sub).filter(s => s !== lastSubject);
  const subject = pick(subjects);
  lastSubject = subject;
  return { text: chosen.text, templateId: chosen.id, subject, family };
}

// ---------- Reply tiering ----------
// "bot" and "pass" removed: "how does the bot work" was closing hot leads.
const NEG = /\b(not interested|no thanks|no thank you|stop messaging|stop dming|remove me|leave me alone|wrong person|not for me|spam|reported|reporting you|i'?m good|don'?t need|not looking|i'?ll pass|pass on (this|that)|nope|nah|scam|fuck off|blocked)\b/i;
const NUMWORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30 };
function parseAccounts(t) {
  const m = t.match(/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty)(?!\s*k\b)(?![\d.,])\s*(?:x\s*)?(?:\w+\s){0,2}?(?:accounts?|accts?|accs?|evals?|combines?|challenges?)\b/i);
  if (!m) return null;
  const v = m[1].toLowerCase();
  return NUMWORDS[v] !== undefined ? NUMWORDS[v] : parseInt(v, 10);
}
function parseSize(t) {
  const k = t.match(/\$?\s?(\d{2,3})\s*k\b/i);
  if (k) return parseInt(k[1], 10) * 1000;
  const full = t.match(/\$\s?(\d{2,3}),000\b/);
  return full ? parseInt(full[1], 10) * 1000 : null;
}
const ICP_WORDS = /\b(funded|payouts?|signal group|my group|my discord|my members|students|my clients|fund manager|pamm|copy ?trad(e|ing)|trade copier)\b/i;
const QUESTION  = /\b(how much|price|cost|pricing|how does it work|how it works|what'?s the catch|results|win rate|proof|track record|legit|tell me more|more info|interested|details|how does the bot)\b/i;
function tierReply(text) {
  if (NEG.test(text)) return { tier: "NEGATIVE" };
  const n = parseAccounts(text), size = parseSize(text);
  if ((n && n >= 5) || (size && size >= 100000) || ICP_WORDS.test(text)) return { tier: "ICP", n, size };
  if (n && n >= 2) return { tier: "MID", n, size };
  if (n !== null && n <= 1) return { tier: "LOW", n, size };
  if (QUESTION.test(text)) return { tier: "QUESTION", n, size };
  return { tier: "UNCLEAR", n, size };
}
// Message two, ready to paste. ICP goes straight to the call.
const SUGGEST = {
  futures: {
    ICP: "that's exactly the setup it's built for. shadowtrade copies every trade to all your accounts at once through traderspost, gold and nasdaq. i've got 15 minutes tomorrow at 10am or 2pm PT to walk you through the live accounts, results are on my instagram jtxcodex",
    MID: "that works, shadowtrade runs on all of them at once through traderspost. what firm are they on, and are you planning to add more accounts",
    LOW: "makes sense. shadowtrade runs on one account too and most clients add more once it passes. what firm are you on",
    QUESTION: "it trades gold and nasdaq on a breakout strategy and copies to your accounts through traderspost, nothing for you to click. price depends on how many accounts you run, how many are you on right now",
    UNCLEAR: "shadowtrade trades gold and nasdaq for you and copies to every prop account through traderspost. how many accounts are you trading right now",
  },
  mt5: {
    ICP: "that's the size it's built for. the ea trades gold on mt5 with your firm's daily and max loss limits built in. i've got 15 minutes tomorrow at 10am or 2pm PT to show you the backtest and live trades, results are on my instagram jtxcodex",
    MID: "that works, the ea runs on each of them and sizes every trade off the balance. what firm are they with",
    LOW: "the ea works on one account too, it sizes every trade off your balance. what firm and account size are you on",
    QUESTION: "it's an mt5 ea that trades gold on a breakout strategy, risk sized off your balance with your firm's loss limits built in. price depends on the account size, what size are you trading",
    UNCLEAR: "shadowtrade is a gold trading bot that runs as an mt5 ea on prop accounts. what size account are you trading right now",
  },
};

async function handleReply(acct, sender, item) {
  const users = loadUsers();
  const u = getUser(users, sender) || {};
  const family = u.family === "mt5" ? "mt5" : "futures";
  const r = tierReply(item.body);
  upsertUser(users, sender, {
    replied: true, reply_type: r.tier, reply_body: item.body.slice(0, 500),
    replied_at: new Date().toISOString(), reply_accounts: r.n ?? null, reply_size: r.size ?? null,
    closed: r.tier === "NEGATIVE", closed_reason: r.tier === "NEGATIVE" ? "not_interested" : null,
  });
  if (r.tier === "NEGATIVE") { log("REPLY_NEG", `u/${sender} | ${u.template || "?"}`); return; }

  const head = r.tier === "ICP" ? "🔥 <b>ICP REPLY</b>" : r.tier === "MID" ? "💰 <b>REPLY, 2 to 4 accounts</b>" : "💬 <b>REPLY</b>";
  const detail = [r.n ? `${r.n} accounts` : "", r.size ? `$${r.size / 1000}K size` : ""].filter(Boolean).join(" · ");
  log(`REPLY_${r.tier}`, `u/${sender} via u/${acct.name}: "${item.body.slice(0, 160)}"`);
  await telegram(
    `${head}${detail ? ` (${esc(detail)})` : ""}\n` +
    `u/${esc(sender)} · r/${esc(u.subreddit || "?")} · via u/${esc(acct.name)} · ${esc(u.template || "?")}\n\n` +
    `"${esc(item.body.slice(0, 400))}"\n\n` +
    `<b>send next:</b>\n<code>${esc(SUGGEST[family][r.tier] || SUGGEST[family].UNCLEAR)}</code>\n\n` +
    `https://www.reddit.com/message/messages/${item.id}\n${esc(u.url || "")}`
  );
}

let inboxBusy = false;
async function checkInbox() {
  if (inboxBusy) return;
  inboxBusy = true;
  try {
    for (const acct of ACCOUNTS) {
      if (disabled.has(acct.name)) continue;
      try {
        const unread = await acct.client.getUnreadMessages({ limit: 50 });
        const toMark = [];
        for (const item of unread) {
          if (item.was_comment !== false || !item.body || !item.author) continue;
          toMark.push(item);
          const sender = item.author.name;
          if (ACCOUNT_NAMES.has(sender.toLowerCase())) continue;
          await handleReply(acct, sender, item);
        }
        for (let i = 0; i < toMark.length; i += 25) {
          try { await acct.client.markMessagesAsRead(toMark.slice(i, i + 25)); }
          catch (err) { log("WARN", `mark read failed: ${err.message}`); }
        }
      } catch (err) {
        log("ERROR", `inbox u/${acct.name}: ${err.message}`);
        if (/401|403|USER_REQUIRED|invalid_grant|suspended/i.test(err.message)) disableAccount(acct, err.message);
      }
    }
  } finally { inboxBusy = false; }
}

// ---------- Leads ----------
function loadLeads() {
  return new Promise(resolve => {
    if (!fs.existsSync(leadsPath)) return resolve([]);
    const arr = [];
    fs.createReadStream(leadsPath).pipe(csv())
      .on("data", row => arr.push(row))
      .on("end", () => resolve(arr))
      .on("error", () => resolve(arr));
  });
}
const leadAge = l => { const t = Date.parse(l["Posted At"] || ""); return t ? (Date.now() - t) / 86400000 : 0; };

const sentWriter = createObjectCsvWriter({
  path: sentPath,
  header: [
    { id: "time", title: "Time" }, { id: "username", title: "Username" }, { id: "via", title: "Via" },
    { id: "templateId", title: "Template ID" }, { id: "subject", title: "Subject" },
    { id: "subreddit", title: "Subreddit" }, { id: "family", title: "Family" },
    { id: "leadType", title: "Lead Type" }, { id: "url", title: "URL" },
  ],
  append: fs.existsSync(sentPath),
});

// ---------- Outreach ----------
async function runOutreachCycle() {
  if (!inSendWindow()) { log("INFO", `Outside send window (${SEND_WINDOW_START}:00 to ${SEND_WINDOW_END}:00 ${process.env.TZ})`); return; }
  if (remainingQuota(loadSendLog()) <= 0) { log("INFO", "All accounts at today's cap"); return; }

  const leads = await loadLeads();
  const vendors = readJSON(vendorsPath, {});
  const users = loadUsers();
  const seen = new Set();
  const queue = leads.filter(l => {
    const k = (l.Username || "").trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    if (vendors[k] || ACCOUNT_NAMES.has(k)) return false;
    const u = users[k];
    if (u && (u.sent || u.closed)) return false;
    return leadAge(l) <= MAX_LEAD_AGE_DAYS;
  }).sort((a, b) => (Date.parse(b["Posted At"]) || 0) - (Date.parse(a["Posted At"]) || 0));

  log("INFO", `${queue.length} traders queued | ${remainingQuota(loadSendLog())} sends left today across ${availableAccounts(loadSendLog()).length} account(s)`);

  for (const lead of queue) {
    if (!inSendWindow()) break;
    const d = loadSendLog();
    const acct = pickAccount(d);
    if (!acct) { log("INFO", "No account with quota left"); break; }

    const username = lead.Username.trim();
    const fresh = getUser(loadUsers(), username);
    if (fresh && (fresh.sent || fresh.closed)) continue;

    const vet = await vetUser(username);
    if (vet.ok === null) { await sleep(3000); continue; }
    if (!vet.ok) {
      if (vet.vendor) markVendor(username, vet.reason);
      upsertUser(loadUsers(), username, { username, sent: false, closed: true, closed_reason: vet.reason });
      log("SKIP", `u/${username} ${vet.reason}`);
      await sleep(1500);
      continue;
    }

    const msg = buildMessage(lead);
    if (!msg) { log("BLOCKED", `u/${username} no safe message`); continue; }

    try {
      await acct.client.composeMessage({ to: username, subject: msg.subject, text: msg.text });
      const st = acctState(d, acct.name);
      if (!st.firstSendAt) st.firstSendAt = Date.now();
      st.sends.push(Date.now());
      saveSendLog(d);

      upsertUser(loadUsers(), username, {
        v: 6, username, via: acct.name, family: msg.family,
        sent: true, sent_at: new Date().toISOString(),
        template: msg.templateId, subject: msg.subject,
        subreddit: lead.Subreddit, url: lead.URL, lead_type: lead["Lead Type"],
        replied: false, reply_type: null, closed: false, closed_reason: null,
      });
      await sentWriter.writeRecords([{
        time: new Date().toISOString(), username, via: acct.name, templateId: msg.templateId,
        subject: msg.subject, subreddit: lead.Subreddit, family: msg.family,
        leadType: lead["Lead Type"], url: lead.URL,
      }]);
      log("SENT", `u/${username} via u/${acct.name} | ${msg.templateId} | r/${lead.Subreddit} | ${sent24(st)}/${capFor(st)}`);
      await sleep(nextDelayMs(remainingQuota(loadSendLog())));
    } catch (err) {
      const m = err.message || String(err);
      log("ERROR", `DM u/${username} via u/${acct.name}: ${m}`);
      if (/NOT_WHITELISTED|USER_DOESNT_EXIST|USER_BLOCKED|INVALID_USER|deleted/i.test(m)) {
        upsertUser(loadUsers(), username, { username, sent: false, closed: true, closed_reason: "cannot_message" });
      }
      if (/RATELIMIT|too fast|try again in/i.test(m)) {
        cooldownUntil.set(acct.name, Date.now() + 15 * 60 * 1000);
        log("WARN", `u/${acct.name} rate limited, 15 min cooldown`);
      } else if (/401|403|USER_REQUIRED|invalid_grant|suspended|Forbidden/i.test(m)) {
        disableAccount(acct, m);
      }
      await sleep(20 * 1000);
    }
  }
}

// ---------- Stats ----------
const warned = new Set();
function reportStats(toTelegram) {
  const users = loadUsers();
  const byT = {}, byA = {};
  for (const u of Object.values(users)) {
    if (u.v !== 6 || !u.sent) continue;
    const t = byT[u.template] = byT[u.template] || { sent: 0, replied: 0, icp: 0 };
    const a = byA[u.via] = byA[u.via] || { sent: 0, replied: 0, icp: 0 };
    for (const o of [t, a]) {
      o.sent++;
      if (u.replied && u.reply_type !== "NEGATIVE") o.replied++;
      if (u.reply_type === "ICP") o.icp++;
    }
  }
  const line = o => `${o.sent} sent, ${o.replied} replies (${o.sent ? (o.replied / o.sent * 100).toFixed(1) : 0}%), ${o.icp} ICP`;
  const tLines = Object.entries(byT).sort((x, y) => (y[1].replied / y[1].sent) - (x[1].replied / x[1].sent)).map(([k, o]) => `${k}: ${line(o)}`);
  const aLines = Object.entries(byA).map(([k, o]) => `u/${k}: ${line(o)}`);
  if (tLines.length) log("STATS", "\n  " + aLines.concat(tLines).join("\n  "));

  for (const [k, o] of Object.entries(byA)) {
    if (o.sent >= 80 && o.replied === 0 && !warned.has(k)) {
      warned.add(k);
      telegram(`⚠️ <b>ClientMagnet</b>\nu/${esc(k)} has 0 replies across ${o.sent} DMs. Check if it's shadowbanned.`);
    }
  }
  if (toTelegram && tLines.length) telegram(`📊 <b>ClientMagnet</b>\n${esc(aLines.join("\n"))}\n\n${esc(tLines.join("\n"))}`);
}

(async () => {
  console.log(`ClientMagnet DM Bot v6 — ${ACCOUNTS.length} account(s), ${PER_ACCOUNT_CAP}/day each after warmup, window ${SEND_WINDOW_START}:00 to ${SEND_WINDOW_END}:00 ${process.env.TZ}`);
  for (const acct of ACCOUNTS) {
    try {
      const me = await acct.client.getMe();
      log("ACCOUNT", `u/${me.name} ok, karma ${(me.link_karma || 0) + (me.comment_karma || 0)}`);
    } catch (err) { disableAccount(acct, `login failed: ${err.message}`); }
  }
  if (!TELEGRAM_TOKEN) console.log("No TELEGRAM_ALERT_TOKEN, reply alerts are off");
  setInterval(checkInbox, INBOX_POLL_MS);
  setInterval(() => reportStats(false), 60 * 60 * 1000);
  setInterval(() => reportStats(true), 12 * 60 * 60 * 1000);
  while (true) {
    await runOutreachCycle();
    await sleep((3 + Math.floor(Math.random() * 4)) * 60 * 1000);
  }
})();
