// agency_bot.cjs — ClientMagnet DM Bot (v5 — real trading templates, age-aware openers, 150/day)
//
// v5, Sep 23. What was broken in v4:
//
// 1. NO TRADING MESSAGE. buildMessage only had ecommerce, local_service,
//    property_mgmt and general. The scraper scores trading leads highest of
//    anything, and then every one of them fell through to the general
//    template and got told "i build automation for businesses dealing with
//    exactly this." To a guy asking who can code his EA. The best vertical
//    was getting the worst message. That is fixed here: trading_custom,
//    trading_install, dashboard and business are all separate.
//
// 2. WRONG INSTAGRAM LINK. v4 pointed at instagram.com/jtx_ai. The handle is
//    jtxcodex. proofLine attaches a link on roughly four sends in nine, so a
//    large share of every DM ever sent pointed at the wrong profile.
//
// 3. NO AGE HANDLING. The scraper now reaches back 180 days. Writing to
//    someone about a four month old post as though it were this morning
//    reads as a bot. Anything over 21 days switches to an opener that says
//    so out loud: "you posted a while back about X, did you ever get it
//    built." Half the answers are no, and that is the whole pitch.
//
// 4. SUBJECT LINE. v4 sent "quick question" on every single message. Now a
//    rotating pool matched to the lead type, never the same one twice in a
//    row, and the banned-opener check covers subjects too.
//
// 5. PACING. v4 did 25-40 per cycle at 45-90s with a 6-9 minute gap, which
//    works out to 50-70 an hour. Now a rolling 24h cap with delays computed
//    from the quota left and the hours left in the send window, so the day's
//    sends spread out instead of firing in bursts.
//
// Voice rules, enforced in code, not just intended: lowercase opener, no
// "i noticed", no "i hope", no "reaching out", no "happy to", one question
// mark maximum, 45 words maximum. Anything violating those is dropped before
// it sends rather than quietly going out.

require("dotenv").config();
const snoowrap = require("snoowrap");
const fs   = require("fs");
const path = require("path");
const csv  = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");

const reddit = new snoowrap({
  userAgent:    process.env.REDDIT_USER_AGENT,
  clientId:     process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username:     process.env.REDDIT_USERNAME,
  password:     process.env.REDDIT_PASSWORD,
});
reddit.config({ requestDelay: 1100, continueAfterRatelimitError: true });

const baseDir = path.resolve(__dirname, "logs");
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
const leadsPath = path.join(baseDir, "clean_leads.csv");
const sentPath  = path.join(baseDir, "clean_leads_dmed.csv");
const usersPath = path.join(baseDir, "contacted_users.json");
const sendLogPath = path.join(baseDir, "send_log.json");

// ---------- Rate ----------
const DAILY_CAP        = 150;   // rolling 24h
const WARMUP_DAYS      = [40, 80, 120];  // day 1, 2, 3 then full cap
const SEND_WINDOW_START = 7;    // local hour
const SEND_WINDOW_END   = 22;
const MIN_DELAY_MS      = 25 * 1000;
const MAX_DELAY_MS      = 11 * 60 * 1000;
const INBOX_POLL_MS     = 60 * 1000;
const MIN_SCORE_TO_DM   = 65;
const PRICE_INSTALL     = "$150";

const LINKEDIN_URL  = "https://www.linkedin.com/in/jesse-torres11/";
const INSTAGRAM_URL = "https://www.instagram.com/jtxcodex/";  // v5 fix, was jtx_ai

const TELEGRAM_TOKEN   = process.env.TELEGRAM_ALERT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_ALERT_CHAT_ID || "";

// Banned forever. Recipients kept replying confused because the opener never
// said what post. Checked against every subject and body before sending.
const BANNED_OPENERS = [
  /\bsaw your post\b/i,
  /\bsaw what you said\b/i,
  /\bchecked out your post\b/i,
  /\bcame across your post\b/i,
  /\bi noticed\b/i,
  /\bi hope this\b/i,
  /\breaching out\b/i,
  /\bhappy to\b/i,
  /\bi wanted to reach\b/i,
  /\bhope you'?re (well|doing)\b/i,
];

function log(tag, msg) { console.log(`[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ---------- Users ----------
function loadUsers() {
  if (!fs.existsSync(usersPath)) return {};
  try { return JSON.parse(fs.readFileSync(usersPath, "utf8")); } catch { return {}; }
}
function saveUsers(u) { fs.writeFileSync(usersPath, JSON.stringify(u, null, 2)); }
function getUser(users, username) { return users[username.toLowerCase()] || null; }
function upsertUser(users, username, fields) {
  const key = username.toLowerCase();
  users[key] = { ...(users[key] || {}), ...fields, last_message_at: new Date().toISOString() };
  saveUsers(users);
  return users[key];
}

// ---------- Send log, rolling 24h ----------
function loadSendLog() {
  if (!fs.existsSync(sendLogPath)) return { firstSendAt: null, sends: [] };
  try {
    const d = JSON.parse(fs.readFileSync(sendLogPath, "utf8"));
    return { firstSendAt: d.firstSendAt || null, sends: Array.isArray(d.sends) ? d.sends : [] };
  } catch { return { firstSendAt: null, sends: [] }; }
}
function saveSendLog(d) {
  const cutoff = Date.now() - 8 * 24 * 3600 * 1000;
  d.sends = d.sends.filter(t => t > cutoff);
  fs.writeFileSync(sendLogPath, JSON.stringify(d));
}
function sentInLast24h(d) {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  return d.sends.filter(t => t > cutoff).length;
}
// Warm the account up rather than going to 150 on day one from a standing
// start. After three days it's the full cap.
function currentCap(d) {
  if (!d.firstSendAt) return WARMUP_DAYS[0];
  const days = Math.floor((Date.now() - d.firstSendAt) / (24 * 3600 * 1000));
  if (days < WARMUP_DAYS.length) return WARMUP_DAYS[days];
  return DAILY_CAP;
}
function inSendWindow() {
  const h = new Date().getHours();
  return h >= SEND_WINDOW_START && h < SEND_WINDOW_END;
}
function minutesLeftInWindow() {
  const now = new Date();
  const end = new Date(now);
  end.setHours(SEND_WINDOW_END, 0, 0, 0);
  return Math.max(1, (end - now) / 60000);
}
// Spread whatever quota is left across whatever window is left, then jitter
// hard so the gaps aren't a metronome.
function nextDelayMs(remainingQuota) {
  if (remainingQuota <= 0) return MAX_DELAY_MS;
  const evenMs = (minutesLeftInWindow() / remainingQuota) * 60000;
  const jittered = evenMs * (0.55 + Math.random() * 0.9);
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, Math.round(jittered)));
}

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

// ---------- Sent CSV ----------
const sentWriter = createObjectCsvWriter({
  path: sentPath,
  header: [
    { id: "time", title: "Time" }, { id: "username", title: "Username" },
    { id: "templateId", title: "Template ID" }, { id: "subject", title: "Subject" },
    { id: "subreddit", title: "Subreddit" }, { id: "vertical", title: "Vertical" },
    { id: "intent", title: "Intent" }, { id: "ageDays", title: "Age Days" },
    { id: "url", title: "Post URL" }, { id: "score", title: "Score" },
  ],
  append: true,
});

// ---------- Reply classification ----------
const positiveReplyRegex = /\b(interested|tell me more|how does it work|how much|what'?s the price|sounds good|yes|yeah|sure|how do i|sign me up|i want|send me|where do i|let'?s do it|can you|would this work|more info|demo|i'?d like|this looks|this sounds|exactly what|been looking for|need this|what would|what do you|what'?s included|how long|timeline|still looking|not yet|never got it|haven'?t built)\b/i;
const negativeReplyRegex = /\b(not interested|no thanks|stop messaging|stop dming|remove me|leave me alone|wrong person|not for me|not relevant|spam|reported|i'?m good|already have|already built|don'?t need|not looking|pass|nope|nah|scam|bot)\b/i;

function classifyReply(text) {
  const t = (text || "").toLowerCase();
  if (negativeReplyRegex.test(t)) return "NEGATIVE";
  if (positiveReplyRegex.test(t)) return "POSITIVE";
  return "UNCLEAR";
}

// ---------- Proof ----------
function proofLine() {
  return pick([
    "", "", "", "", "",
    `linkedin if it helps, ${LINKEDIN_URL}`,
    `i post the real client builds here, ${INSTAGRAM_URL}`,
    `examples of what i've built, ${INSTAGRAM_URL}`,
  ]);
}
function withProof(base) {
  const proof = proofLine();
  return proof ? `${base}. ${proof}` : base;
}

// ---------- Subjects ----------
// Lowercase, short, specific to the lead. Never "quick question" on
// everything, and never the same one twice in a row.
const SUBJECTS = {
  trading_custom: ["your ea post", "pine script", "automating that strategy", "the strategy you posted", "getting that coded", "your strategy"],
  trading_install: ["your prop account", "the eval", "prop firm bot", "your funded account", "automating the account"],
  dashboard: ["tracking all those accounts", "your prop accounts", "all those evals", "one screen for your accounts"],
  business: ["the manual work you mentioned", "automating that", "that process you described", "the thing you posted about"],
  old: ["did you ever get this built", "still looking for this", "that thing you posted about", "did this ever get done"],
};
let lastSubject = "";
function pickSubject(intent, isOld) {
  const pool = isOld
    ? SUBJECTS.old.concat(SUBJECTS[intent] || SUBJECTS.business)
    : (SUBJECTS[intent] || SUBJECTS.business);
  const options = pool.filter(s => s !== lastSubject);
  const chosen = pick(options.length ? options : pool);
  lastSubject = chosen;
  return chosen;
}

// ---------- Pain phrase handling ----------
// The scraper captures the lead's own words, which are first person: "i need
// someone to code my strategy". Dropping that straight into our sentence
// makes US the one asking for help, which is what v4 did and it read as
// nonsense. Flip it to second person, and only use the result if it actually
// came out addressed to them.
function toSecondPerson(phrase) {
  let t = " " + phrase.toLowerCase().trim() + " ";
  const swaps = [
    [/\bi'?m\b/g, "you're"], [/\bi am\b/g, "you're"],
    [/\bi'?ve\b/g, "you've"], [/\bi have\b/g, "you have"],
    [/\bi'?ll\b/g, "you'll"], [/\bi'?d\b/g, "you'd"],
    [/\bi can'?t\b/g, "you can't"], [/\bi\b/g, "you"],
    [/\bmyself\b/g, "yourself"], [/\bmy\b/g, "your"], [/\bmine\b/g, "yours"],
    [/\bwe'?re\b/g, "you're"], [/\bwe\b/g, "you"], [/\bour\b/g, "your"],
  ];
  for (const [rx, to] of swaps) t = t.replace(rx, to);
  t = t.replace(/\s+/g, " ").trim();
  // A truncated capture can end mid-thought; trim dangling connectives.
  t = t.replace(/\s+(and|but|or|that|to|the|a|an|for|with|of|in|on)$/i, "").trim();
  return t;
}
// Only usable if the flip actually produced something addressed to them.
// "can anyone build this" doesn't, so those fall back to the intent phrase.
function secondPersonTopic(phrase) {
  if (!phrase) return "";
  const t = toSecondPerson(phrase);
  if (!/^you\b|^you'/.test(t)) return "";
  if (t.split(/\s+/).length < 3) return "";
  return t;
}
// For "you posted a while back about ___" we need a noun, not a clause.
function objectNoun(text, intent) {
  if (/\bexpert advisor\b|\bea\b/i.test(text)) return "getting your ea built";
  if (/pine ?script/i.test(text)) return "getting your pine script strategy automated";
  if (/\bindicator\b/i.test(text)) return "getting your indicator coded";
  if (/\bmql[45]?\b/i.test(text)) return "getting your mql strategy built";
  if (/\bstrategy\b|\bsystem\b/i.test(text)) return "getting your strategy automated";
  if (intent === "dashboard") return "tracking your accounts";
  if (intent === "trading_install") return "automating your account";
  if (intent && intent.startsWith("trading")) return "getting a bot built";
  return "automating something you were doing by hand";
}

// ---------- Message bodies ----------
// Old leads get a different frame entirely. Naming the gap is the strongest
// thing available: most of these people never did get it built.
function oldVariants(topic, intent) {
  if (intent === "dashboard") {
    return [
      { id: "OLD_DASH_1", text: withProof(`hey, you posted a while back about running accounts across a few firms. did you ever get one screen that shows all of them. that's what i build`) },
      { id: "OLD_DASH_2", text: withProof(`hey, you were juggling multiple prop accounts a while ago. still checking each platform separately or did you find something`) },
    ];
  }
  if (intent === "trading_custom") {
    return [
      { id: "OLD_TC_1", text: withProof(`hey, you posted a while back about ${topic}. did you ever get it built. i do these and most people i talk to never found anyone`) },
      { id: "OLD_TC_2", text: withProof(`hey, a while back you were after ${topic}. is it still sitting unfinished. i build them for traders`) },
      { id: "OLD_TC_3", text: withProof(`hey, you were looking to get a strategy automated a while ago. did that ever happen. if not i can tell you what it'd take`) },
    ];
  }
  if (intent === "trading_install") {
    return [
      { id: "OLD_TI_1", text: withProof(`hey, you were after a bot for your account a while back. still running it manually. i set mine up on client accounts for ${PRICE_INSTALL}`) },
      { id: "OLD_TI_2", text: withProof(`hey, you posted a while back about automating your account. did you ever get something running`) },
    ];
  }
  return [
    { id: "OLD_BIZ_1", text: withProof(`hey, you posted a while back about ${topic}. did you ever get that sorted or is it still manual`) },
    { id: "OLD_BIZ_2", text: withProof(`hey, a while back you mentioned ${topic}. is that still eating your time. i build tools for exactly this`) },
  ];
}

function tradingCustomVariants(topic) {
  return [
    { id: "TC_1", text: withProof(`hey, ${topic}. i build these for traders, mt4/mt5 and futures through traderspost. what's the strategy written in right now`) },
    { id: "TC_2", text: withProof(`hey, ${topic}. this is my main thing. is it written out as rules already or still in your head`) },
    { id: "TC_3", text: withProof(`hey, ${topic}. i can get it coded and running on your account. what platform are you trading on`) },
  ];
}
function tradingInstallVariants() {
  return [
    { id: "TI_1", text: withProof(`hey, i run a gold and nasdaq bot and i set it up on client accounts for ${PRICE_INSTALL}. what firm are you on`) },
    { id: "TI_2", text: withProof(`hey, i've got a futures bot running on client accounts right now, ${PRICE_INSTALL} to set up on yours. which prop firm`) },
    { id: "TI_3", text: withProof(`hey, if you want something already built rather than paying for a custom job, mine's ${PRICE_INSTALL} installed on your account. what are you trading`) },
  ];
}
function dashboardVariants(accounts) {
  const n = accounts && accounts !== "multiple" ? `${accounts} accounts` : "accounts across a few firms";
  return [
    { id: "DASH_1", text: withProof(`hey, ${n} and no single screen telling you what any of them are doing. i build that. every account, every trade, live pnl, one page`) },
    { id: "DASH_2", text: withProof(`hey, how are you tracking ${n} right now. i build dashboards that pull every account into one screen, which firms are you on`) },
    { id: "DASH_3", text: withProof(`hey, running ${n} means logging into each platform just to see anything. i build one dashboard that shows all of them. how many firms are you spread across`) },
  ];
}
function businessVariants(topic) {
  return [
    { id: "BIZ_1", text: withProof(`hey, ${topic}. that's the kind of thing i automate. what's the process look like right now, all by hand`) },
    { id: "BIZ_2", text: withProof(`hey, ${topic}. i build tools for exactly this. how much time is it costing you a week`) },
    { id: "BIZ_3", text: withProof(`hey, ${topic}. i can build something that handles it. what are you using to manage it at the moment`) },
  ];
}

function violatesBannedOpener(text) {
  return BANNED_OPENERS.some(rx => rx.test(text));
}
// Enforced, not aspirational. A template that drifts into two questions or
// runs long gets dropped rather than sent.
function violatesVoiceRules(text) {
  if ((text.match(/\?/g) || []).length > 1) return true;
  if (text.trim().split(/\s+/).length > 45) return true;
  if (/^[A-Z]/.test(text.trim())) return true;
  return false;
}

function buildMessage(lead) {
  const intent = (lead.Intent || "business").toLowerCase();
  const ageDays = parseFloat(lead["Age Days"] || "0") || 0;
  const isOld = ageDays > 21;
  const pain = (lead["Pain Phrase"] || "").trim();
  const accounts = (lead.Accounts || "").trim();

  const source = `${pain} ${lead.Title || ""} ${lead.Selftext || ""}`;
  const fallbackTopic = intent.startsWith("trading") ? "you're after a bot for your strategy" : "you're doing that by hand";
  const topic = secondPersonTopic(pain) || fallbackTopic;
  const nounTopic = objectNoun(source, intent);

  let variants;
  if (isOld) variants = oldVariants(nounTopic, intent);
  else if (intent === "dashboard") variants = dashboardVariants(accounts);
  else if (intent === "trading_custom") variants = tradingCustomVariants(topic);
  else if (intent === "trading_install") variants = tradingInstallVariants();
  else variants = businessVariants(topic);

  const safe = variants.filter(v => !violatesBannedOpener(v.text) && !violatesVoiceRules(v.text));
  const chosen = safe.length ? pick(safe) : null;
  if (!chosen) return null;

  const subject = pickSubject(intent, isOld);
  if (violatesBannedOpener(subject)) return null;
  return { text: chosen.text, templateId: chosen.id, subject };
}

// ---------- Leads ----------
function scoreOf(p) { return parseInt(p.Score || "0", 10) || 0; }

function loadLeads() {
  return new Promise(resolve => {
    if (!fs.existsSync(leadsPath)) return resolve([]);
    const arr = [];
    fs.createReadStream(leadsPath)
      .pipe(csv())
      .on("data", row => arr.push(row))
      .on("end", () => resolve(arr))
      .on("error", () => resolve(arr));
  });
}

// ---------- Inbox ----------
let repliesSeen = 0, positiveSeen = 0;
async function checkInbox() {
  const botUsername = (process.env.REDDIT_USERNAME || "").toLowerCase();
  try {
    const unread = await reddit.getUnreadMessages({ limit: 50 });
    const toMarkRead = [];
    for (const item of unread) {
      if (item.was_comment !== false || !item.body || !item.author) continue;
      toMarkRead.push(item);
      const sender = item.author.name;
      if (sender.toLowerCase() === botUsername) continue;

      const replyType = classifyReply(item.body);
      const users = loadUsers();
      const existing = getUser(users, sender);
      const tpl = (existing && existing.template) || "unknown";
      repliesSeen++;

      if (replyType === "NEGATIVE") {
        log("REPLY_NEG", `u/${sender} not interested | template:${tpl}`);
        upsertUser(users, sender, { replied: true, reply_type: "NEGATIVE", closed: true, closed_reason: "not_interested" });
      } else if (replyType === "POSITIVE") {
        positiveSeen++;
        log("HOT_LEAD", `u/${sender}: "${item.body.slice(0, 200)}" template:${tpl}`);
        upsertUser(users, sender, { replied: true, reply_type: "POSITIVE", reply_body: item.body.slice(0, 500), closed: false });
        await telegram(
          `🔥 <b>HOT LEAD</b>\nu/${sender}\n<i>${(existing && existing.subreddit) || "?"} · ${tpl}</i>\n\n${item.body.slice(0, 350)}\n\nhttps://reddit.com/message/inbox/`
        );
      } else {
        log("REPLY_UNCLEAR", `u/${sender} replied, review manually | template:${tpl}`);
        upsertUser(users, sender, { replied: true, reply_type: "UNCLEAR", reply_body: item.body.slice(0, 500), closed: false });
        await telegram(`💬 <b>REPLY</b>\nu/${sender}\n\n${item.body.slice(0, 350)}`);
      }
    }
    if (toMarkRead.length) {
      for (let i = 0; i < toMarkRead.length; i += 25) {
        try { await reddit.markMessagesAsRead(toMarkRead.slice(i, i + 25)); }
        catch (err) { log("WARN", `markMessagesAsRead failed: ${err.message}`); }
      }
    }
  } catch (err) {
    log("ERROR", `Inbox check failed: ${err.message}`);
  }
}

// ---------- Outreach ----------
async function runOutreachCycle() {
  const sendLog = loadSendLog();
  const cap = currentCap(sendLog);
  let sentToday = sentInLast24h(sendLog);

  if (sentToday >= cap) { log("INFO", `Cap reached (${sentToday}/${cap} in last 24h). Holding.`); return; }
  if (!inSendWindow()) { log("INFO", `Outside send window (${SEND_WINDOW_START}:00-${SEND_WINDOW_END}:00). Holding.`); return; }

  const leads = await loadLeads();
  if (!leads.length) { log("INFO", "No leads in CSV. Run the scraper."); return; }

  const seen = new Set();
  const queue = leads
    .filter(p => {
      const k = (p.Username || "").trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return scoreOf(p) >= MIN_SCORE_TO_DM;
    })
    .sort((a, b) => scoreOf(b) - scoreOf(a));

  log("INFO", `${queue.length} unique leads queued | ${sentToday}/${cap} sent in last 24h | replies ${repliesSeen} (${positiveSeen} hot)`);

  for (const lead of queue) {
    if (sentToday >= cap) { log("INFO", `Cap reached (${cap}).`); break; }
    if (!inSendWindow()) { log("INFO", "Send window closed."); break; }

    const username = (lead.Username || "").trim();
    if (!username) continue;

    const users = loadUsers();
    const user = getUser(users, username);
    if (user && (user.sent || user.closed)) continue;

    const msg = buildMessage(lead);
    if (!msg) { log("BLOCKED", `u/${username} produced no safe message`); continue; }
    if (violatesBannedOpener(msg.text) || violatesVoiceRules(msg.text)) {
      log("BLOCKED", `u/${username} message failed final check`);
      continue;
    }

    try {
      await reddit.composeMessage({ to: username, subject: msg.subject, text: msg.text });
      sentToday++;
      if (!sendLog.firstSendAt) sendLog.firstSendAt = Date.now();
      sendLog.sends.push(Date.now());
      saveSendLog(sendLog);

      log("SENT", `u/${username} | ${msg.templateId} | "${msg.subject}" | age:${lead["Age Days"]}d | score:${scoreOf(lead)} | ${sentToday}/${cap}`);

      upsertUser(loadUsers(), username, {
        username, vertical: lead.Vertical, intent: lead.Intent,
        sent: true, sent_at: new Date().toISOString(),
        template: msg.templateId, subject: msg.subject,
        replied: false, reply_type: null, reply_body: null,
        closed: false, closed_reason: null,
        url: lead.URL, subreddit: lead.Subreddit, score: scoreOf(lead),
        age_days: lead["Age Days"],
      });

      await sentWriter.writeRecords([{
        time: new Date().toISOString(), username, templateId: msg.templateId,
        subject: msg.subject, subreddit: lead.Subreddit, vertical: lead.Vertical,
        intent: lead.Intent, ageDays: lead["Age Days"], url: lead.URL, score: scoreOf(lead),
      }]);

      await sleep(nextDelayMs(cap - sentToday));
    } catch (err) {
      log("ERROR", `DM failed u/${username}: ${err.message}`);
      if (/NOT_WHITELISTED|USER_DOESNT_EXIST|BANNED|BLOCKED|deleted/i.test(err.message)) {
        upsertUser(loadUsers(), username, { username, sent: false, closed: true, closed_reason: "blocked_or_banned" });
      }
      // Reddit throttling us is the one error worth backing off hard on.
      if (/RATELIMIT|too fast|try again in/i.test(err.message)) {
        log("WARN", "Rate limited by Reddit, backing off 10 minutes.");
        await sleep(10 * 60 * 1000);
      } else {
        await sleep(20 * 1000);
      }
    }
  }
}

// Reply rate is the cheap early warning. If this floor drops out across a
// large number of sends, stop and check the account manually before burning
// more of the backlog.
function reportReplyRate() {
  const d = loadSendLog();
  const total = d.sends.length;
  if (total < 40) return;
  const rate = (repliesSeen / total * 100).toFixed(1);
  log("STATS", `${total} sends tracked | ${repliesSeen} replies (${rate}%) | ${positiveSeen} hot`);
  if (repliesSeen === 0 && total >= 80) {
    log("WARN", "Zero replies across 80+ sends. Check the account is not shadowbanned before continuing.");
    telegram("⚠️ <b>ClientMagnet</b>\nZero replies across 80+ sends. Check whether the Reddit account is shadowbanned.");
  }
}

(async () => {
  console.log("ClientMagnet DM Bot v5 — trading templates, age-aware openers, rolling daily cap");
  const d = loadSendLog();
  console.log(`Cap today: ${currentCap(d)} | sent last 24h: ${sentInLast24h(d)} | window ${SEND_WINDOW_START}:00-${SEND_WINDOW_END}:00`);
  if (!TELEGRAM_TOKEN) console.log("No TELEGRAM_ALERT_TOKEN in .env — hot lead alerts disabled.");
  setInterval(checkInbox, INBOX_POLL_MS);
  setInterval(reportReplyRate, 15 * 60 * 1000);
  while (true) {
    await runOutreachCycle();
    const delay = (4 + Math.floor(Math.random() * 4)) * 60 * 1000;
    log("INFO", `Next cycle in ${Math.round(delay / 60000)} min.`);
    await sleep(delay);
  }
})();
