// agency_bot.cjs — ClientMagnet DM Bot
// DEVHIRE + TRADINGBOT only. No lockedIn. DM sending only.
// scraper.cjs handles all lead generation. This file never scrapes.

require("dotenv").config();
const snoowrap = require("snoowrap");
const fs       = require("fs");
const path     = require("path");
const csv      = require("csv-parser");
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
const sentPath  = path.join(baseDir, "clean_leads_dmed.csv");
const usersPath = path.join(baseDir, "contacted_users.json");

const MIN_DMS_PER_CYCLE = 60;
const MAX_DMS_PER_CYCLE = 80;
const MIN_DELAY_MS      = 45 * 1000;
const MAX_DELAY_MS      = 90 * 1000;
const INBOX_POLL_MS     = 60 * 1000;
const MIN_SCORE_TO_DM   = 60;

function loadUsers() {
  if (!fs.existsSync(usersPath)) return {};
  try { return JSON.parse(fs.readFileSync(usersPath, "utf8")); }
  catch { return {}; }
}
function saveUsers(u) { fs.writeFileSync(usersPath, JSON.stringify(u, null, 2)); }
function getUser(users, username) { return users[username.toLowerCase()] || null; }
function upsertUser(users, username, fields) {
  const key = username.toLowerCase();
  users[key] = { ...(users[key] || {}), ...fields, last_message_at: new Date().toISOString() };
  saveUsers(users);
  return users[key];
}

const sentWriter = createObjectCsvWriter({
  path: sentPath,
  header: [
    { id: "time",       title: "Time" },
    { id: "username",   title: "Username" },
    { id: "templateId", title: "Template ID" },
    { id: "subreddit",  title: "Subreddit" },
    { id: "leadType",   title: "Lead Type" },
    { id: "trigger",    title: "Matched Trigger" },
    { id: "url",        title: "Post URL" },
    { id: "product",    title: "Product" },
    { id: "score",      title: "Score" },
  ],
  append: true,
});

function log(tag, msg) { console.log(`[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ─── REPLY CLASSIFICATION ─────────────────────────────────────────────────────
const positiveReplyRegex = /\b(interested|tell me more|how does it work|how much|what's the price|what is the price|sounds good|yes|yeah|sure|how do i|sign me up|i want|send me|where do i|let's do it|lets do it|can you|would this work|more info|more information|demo|trial|how to get started|i'd like|i would like|this looks|this sounds|great|awesome|exactly what|been looking for|need this|what would|what do you|what's your|what's included|how long|timeline|what exchange|what platform|tell me)\b/i;

const negativeReplyRegex = /\b(not interested|no thanks|no thank you|stop messaging|stop dming|don't message|do not message|remove me|leave me alone|wrong person|not for me|not relevant|spam|reported|i'm good|im good|i'm all set|im all set|already have|don't need|not looking|not right now|pass|nope|nah|go away|scam|bot)\b/i;

function classifyReply(text) {
  const t = (text || "").toLowerCase();
  if (negativeReplyRegex.test(t)) return "NEGATIVE";
  if (positiveReplyRegex.test(t)) return "POSITIVE";
  return "UNCLEAR";
}

// ─── DEVHIRE MESSAGES ─────────────────────────────────────────────────────────
function buildDevHireMessage(post) {
  const title = (post.title || "").replace(/^\[.*?\]\s*/i, "").trim().toLowerCase().slice(0, 80);
  const budget = (post.budget || "").trim();
  const isUrgent = (post.leadType || "").toUpperCase() === "DEV_HIRE_URGENT";

  const budgetLine = budget ? ` Budget works.` : "";
  const timing = isUrgent ? " I can start today." : " Delivered in 48 hours.";

  const openers = [
    `saw your post about ${title}.`,
    `your post about ${title} caught my eye.`,
    `just saw your post about ${title}.`,
  ];

  const bodies = [
    `i build custom bots and automation tools for businesses. recent work: a custom ordering platform for a print shop, a multi-account booking bot for a logistics company, and a live automated trading bot on a funded account. flat fee, no hourly.`,
    `this is what i do. i build custom automation, scrapers, bots, and web apps for businesses. recent builds include a custom b2b ordering platform, a booking automation bot, and a live trading bot. flat fee only.`,
    `i specialize in exactly this. custom bots, automation tools, scrapers, web apps. recent work includes a print shop ordering platform, an appointment booking bot, and a futures trading bot. flat fee, built fast.`,
  ];

  const closes = [
    `${timing}${budgetLine}\n\nwhat are the full details?`,
    `${timing}${budgetLine}\n\ndm me the scope and i'll send a quote today.`,
    `${timing}${budgetLine}\n\nwhat exactly do you need built?`,
  ];

  return `${pick(openers)}\n\n${pick(bodies)}\n\n${pick(closes)}`;
}

// ─── TRADINGBOT MESSAGES ──────────────────────────────────────────────────────
const TRADINGBOT_MESSAGES = [
  {
    id: "TB_1",
    text: `saw your post. if you have a strategy that works manually and you want it running automatically, i can build that.\n\ni built a live futures bot on a funded Topstep account. handles entries, exits, position sizing, and risk rules automatically. flat fee, delivered in 48 hours.\n\nwhat exchange are you on and what does your strategy look like?`
  },
  {
    id: "TB_2",
    text: `saw your post. i build custom trading bots for people with real strategies.\n\nrecent build: fully automated futures bot on a funded account. entries, exits, and risk management running 24/7 without manual execution.\n\nyou bring the strategy, i build the infrastructure. flat fee only.\n\nwhat are you trading and what do you want automated?`
  },
  {
    id: "TB_3",
    text: `saw your post. automating proven trading strategies is what i do.\n\ni've built a live execution bot for a funded futures account. Python, connected directly to the exchange API. no third party tools, no monthly fees, you own the code.\n\nwhat does your setup look like?`
  },
  {
    id: "TB_4",
    text: `saw your post. i build trading bots for people who already have an edge and want it running hands-off.\n\nlive example: automated futures bot on a funded Topstep account with full risk management. flat fee, you own it outright.\n\nwhat exchange and strategy are you working with?`
  },
  {
    id: "TB_5",
    text: `saw your post. if your strategy is profitable manually the next step is automating it.\n\ni build custom execution bots connected directly to exchange APIs. recent work includes a live funded futures account bot with automated entries, exits, and drawdown protection.\n\nflat fee, 48 hour delivery. what are you trading?`
  },
];

// ─── SCORING ──────────────────────────────────────────────────────────────────
function scoreLead(p) {
  const preScore = parseInt(p.score || "0");
  if (preScore > 0) return preScore;

  let score = 0;
  const product  = (p.product  || "").toUpperCase();
  const leadType = (p.leadType || "").toUpperCase();

  if (product === "TRADINGBOT") score += 70;
  if (product === "DEVHIRE")    score += 50;
  if (leadType === "DEV_HIRE_URGENT")    score += 30;
  if (leadType === "DEV_HIRE_SUBREDDIT") score += 20;
  if (leadType === "TRADING_BOT")        score += 40;

  return score;
}

// ─── LEAD LOADER ──────────────────────────────────────────────────────────────
function loadLeads() {
  return new Promise(resolve => {
    if (!fs.existsSync(leadsPath)) return resolve([]);
    const arr = [];
    fs.createReadStream(leadsPath)
      .pipe(csv())
      .on("data", row => arr.push(row))
      .on("end",  () => resolve(arr))
      .on("error", () => resolve(arr));
  });
}

// ─── INBOX HANDLER ────────────────────────────────────────────────────────────
async function checkInbox() {
  const botUsername = (process.env.REDDIT_USERNAME || "").toLowerCase();
  try {
    const unread = await reddit.getUnreadMessages({ limit: 50 });
    const toMarkRead = [];

    for (const item of unread) {
      if (item.was_comment !== false || !item.body || !item.author) continue;
      toMarkRead.push(item);

      const sender = item.author.name.toLowerCase();
      if (sender === botUsername) continue;

      const replyType = classifyReply(item.body);
      const users = loadUsers();

      if (replyType === "NEGATIVE") {
        log("REPLY_NEG", `u/${item.author.name} — not interested`);
        upsertUser(users, item.author.name, {
          replied: true, reply_type: "NEGATIVE",
          closed: true, closed_reason: "not_interested"
        });
      } else if (replyType === "POSITIVE") {
        log("HOT_LEAD", `\n${"=".repeat(60)}\nHOT LEAD — CHECK REDDIT NOW\nu/${item.author.name}: "${item.body.slice(0, 200)}"\n${"=".repeat(60)}`);
        upsertUser(users, item.author.name, {
          replied: true, reply_type: "POSITIVE",
          reply_body: item.body.slice(0, 500), closed: false
        });
      } else {
        log("REPLY_UNCLEAR", `u/${item.author.name} replied — REVIEW MANUALLY\n"${item.body.slice(0, 200)}"`);
        upsertUser(users, item.author.name, {
          replied: true, reply_type: "UNCLEAR",
          reply_body: item.body.slice(0, 500), closed: false
        });
      }
    }

    if (toMarkRead.length > 0) {
      for (let i = 0; i < toMarkRead.length; i += 25) {
        try {
          await reddit.markMessagesAsRead(toMarkRead.slice(i, i + 25));
        } catch (err) {
          log("WARN", `markMessagesAsRead failed: ${err.message}`);
        }
      }
    }
  } catch (err) {
    log("ERROR", `Inbox check failed: ${err.message}`);
  }
}

// ─── OUTREACH CYCLE ───────────────────────────────────────────────────────────
async function runOutreachCycle() {
  const leads = await loadLeads();
  if (!leads.length) { log("INFO", "No leads in CSV."); return; }

  const seenUsernames = new Set();
  const deduped = leads.filter(p => {
    const k = (p.username || "").trim().toLowerCase();
    if (!k || seenUsernames.has(k)) return false;
    seenUsernames.add(k);
    return true;
  });

  deduped.sort((a, b) => scoreLead(b) - scoreLead(a));

  const target    = MIN_DMS_PER_CYCLE + Math.floor(Math.random() * (MAX_DMS_PER_CYCLE - MIN_DMS_PER_CYCLE + 1));
  const cycleSeen = new Set();
  let attempted = 0, confirmed = 0;

  for (const post of deduped) {
    if (attempted >= target) { log("INFO", `Cycle target reached (${target} DMs).`); break; }

    const username  = (post.username || "").trim();
    const url       = (post.url      || "").trim();
    const product   = (post.product  || "").trim().toUpperCase();
    const leadType  = (post.leadType || "").trim().toUpperCase();
    const subreddit = (post.subreddit || "").trim();
    const trigger   = (post.matchedTrigger || "").trim();

    if (!username) continue;
    if (cycleSeen.has(username.toLowerCase())) continue;
    if (product !== "DEVHIRE" && product !== "TRADINGBOT") continue;

    const users = loadUsers();
    const user  = getUser(users, username);
    if (user?.sent || user?.closed) { log("SKIP", `already contacted u/${username}`); continue; }

    const score = scoreLead(post);
    if (score < MIN_SCORE_TO_DM) {
      log("SKIP", `u/${username} score ${score} below ${MIN_SCORE_TO_DM}`);
      continue;
    }

    cycleSeen.add(username.toLowerCase());
    attempted++;

    let tplText, tplId, subject;

    if (product === "TRADINGBOT") {
      const tpl = pick(TRADINGBOT_MESSAGES);
      tplText = tpl.text; tplId = tpl.id; subject = "saw your post";
    } else {
      tplText = buildDevHireMessage(post);
      tplId   = leadType === "DEV_HIRE_URGENT" ? "DH_URGENT" : "DH_STANDARD";
      subject = leadType === "DEV_HIRE_URGENT" ? "available now" : "saw your post";
    }

    try {
      const freshUsers = loadUsers();
      const freshUser  = getUser(freshUsers, username);
      if (freshUser?.sent) { log("SKIP", `u/${username} already sent (fresh check)`); continue; }

      await reddit.composeMessage({ to: username, subject, text: tplText });
      confirmed++;
      log("SENT", `u/${username} | ${tplId} | [${product}] | score:${score} | budget:${post.budget || "unknown"}`);

      upsertUser(freshUsers, username, {
        username, product, leadType,
        sent: true, sent_at: new Date().toISOString(), template: tplId,
        replied: false, reply_type: null, reply_body: null,
        closed: false, closed_reason: null,
        trigger, url, subreddit, score,
      });

      await sentWriter.writeRecords([{
        time: new Date().toISOString(), username, templateId: tplId,
        subreddit, leadType, trigger, url, product, score,
      }]);

      if (attempted < target) {
        const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
        log("INFO", `Waiting ${Math.round(delay / 1000)}s...`);
        await sleep(delay);
      }
    } catch (err) {
      log("ERROR", `DM failed u/${username}: ${err.message}`);
      if (/NOT_WHITELISTED|USER_DOESNT_EXIST|BANNED|BLOCKED/.test(err.message)) {
        const u = loadUsers();
        upsertUser(u, username, { username, sent: false, closed: true, closed_reason: "blocked_or_banned" });
      }
    }
  }

  log("INFO", `Cycle complete — attempted: ${attempted}, confirmed: ${confirmed}`);
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────
(async () => {
  console.log("=".repeat(60));
  console.log("ClientMagnet DM Bot — DEVHIRE + TRADINGBOT");
  console.log("=".repeat(60));

  setInterval(checkInbox, INBOX_POLL_MS);

  while (true) {
    console.log(`\n[${new Date().toLocaleString()}] Starting outreach cycle...`);
    await runOutreachCycle();
    const delay = (6 + Math.floor(Math.random() * 3)) * 60 * 1000;
    log("INFO", `Next cycle in ${Math.round(delay / 60000)} minutes...`);
    await sleep(delay);
  }
})();
