// agency_bot.cjs — Improved version (No links in DMs + Better messaging)
require("dotenv").config();
const snoowrap = require("snoowrap");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");

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
const sentPath = path.join(baseDir, "clean_leads_dmed.csv");
const usersPath = path.join(baseDir, "contacted_users.json");

const MIN_DMS_PER_CYCLE = 50;
const MAX_DMS_PER_CYCLE = 70;
const MIN_DELAY_MS = 50 * 1000;
const MAX_DELAY_MS = 95 * 1000;
const INBOX_POLL_MS = 60 * 1000;

// ─── USER TRACKING ───────────────────────────────────────────────────────────
function loadUsers() {
  if (!fs.existsSync(usersPath)) return {};
  try { return JSON.parse(fs.readFileSync(usersPath, "utf8")); }
  catch { return {}; }
}
function saveUsers(users) { fs.writeFileSync(usersPath, JSON.stringify(users, null, 2)); }
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
    { id: "time", title: "Time" }, { id: "username", title: "Username" },
    { id: "templateId", title: "Template ID" }, { id: "subreddit", title: "Subreddit" },
    { id: "leadType", title: "Lead Type" }, { id: "trigger", title: "Matched Trigger" },
    { id: "url", title: "Post URL" }, { id: "product", title: "Product" },
  ],
  append: true
});

function log(tag, msg) { console.log(`[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ─── REPLY CLASSIFICATION ────────────────────────────────────────────────────
const positiveReplyRegex = /\b(interested|tell me more|how does it work|how much|what's the price|sounds good|yes|yeah|sure|how do i|sign me up|i want|send me|where do i|how do i get|let's do it|can you|would this work|more info|demo|trial|how to get started|i'd like|this looks|this sounds|great|awesome|exactly what|been looking for|need this)\b/i;

const negativeReplyRegex = /\b(not interested|no thanks|stop messaging|don't message|remove me|unsubscribe|leave me alone|wrong person|not for me|spam|already have|don't need|not looking|pass|nope|scam)\b/i;

function classifyReply(text) {
  const t = (text || "").toLowerCase();
  if (negativeReplyRegex.test(t)) return "NEGATIVE";
  if (positiveReplyRegex.test(t)) return "POSITIVE";
  return "UNCLEAR";
}

// ─── IMPROVED MESSAGES (NO LINKS) ────────────────────────────────────────────

// DevHire Messages
function buildDevHireMessage(post) {
  const title = (post.title || "").replace(/^\[.*?\]\s*/i, "").trim().toLowerCase().slice(0, 85);
  const budget = (post.budget || "").trim();
  const isUrgent = (post.leadType || "").toUpperCase() === "DEV_HIRE_URGENT";

  const budgetLine = budget ? ` Budget mentioned looks workable for me.` : "";
  const timing = isUrgent ? " I can start right away." : " I can usually turn these around in 48 hours.";

  const openers = [
    `Saw your post about ${title}.`,
    `Your post about ${title} caught my attention.`,
    `Just came across your post about ${title}.`,
  ];

  const bodies = [
    `I build this kind of thing regularly. Recent work includes Reddit automation tools, Google Maps lead scrapers, and custom booking/automation systems for businesses.`,
    `This type of project is in my wheelhouse. I've shipped automation bots, scrapers with email lookup, and custom workflow tools for clients.`,
    `I've built similar tools before — including automation systems and data scrapers that are currently in use.`,
  ];

  const closes = [
    `Flat fee only.${timing}${budgetLine}\n\nWhat are the full details?`,
    `Flat fee, delivered quickly.${timing}${budgetLine}\n\nHappy to take a look at the full scope.`,
    `Flat fee only.${timing}${budgetLine}\n\nWhat exactly are you looking to have built?`,
  ];

  return `${pick(openers)}\n\n${pick(bodies)}\n\n${pick(closes)}`;
}

// Trading Bot Messages (Improved - No links)
const TRADINGBOT_MESSAGES = [
  {
    id: "TB_1",
    text: `Saw your post. I build custom trading bots for people running real strategies.\n\nI recently built a live futures bot that ran on a funded account with full execution, position sizing, and risk rules.\n\nWhat exchange and strategy are you working with?`
  },
  {
    id: "TB_2",
    text: `Saw your post. I specialize in turning trading strategies into automated bots.\n\nRecent project: A fully automated futures bot with entries, exits, and risk management running on a funded account.\n\nWhat are you trying to automate?`
  },
  {
    id: "TB_3",
    text: `Saw your post. I build trading bots for traders who already have a working strategy.\n\nI’ve shipped live automated systems including a futures bot on a funded account with full trade lifecycle handling.\n\nWhat does your current setup look like?`
  },
];

// LockedIn Messages (No links + softer)
const LOCKEDIN_MESSAGES = [
  {
    id: "LI_1",
    text: `Saw your post. I had the same issue so I built something that helps.\n\nYou type out everything you need to do, and it turns it into a clean time-blocked schedule that goes straight into your calendar.\n\nTakes about 10 seconds.`
  },
  {
    id: "LI_2",
    text: `Saw your post. I built a simple tool for this exact problem.\n\nDump all your tasks in any order and it builds a realistic daily schedule and adds it to your calendar automatically.\n\nNo manual dragging or planning needed.`
  },
  {
    id: "LI_3",
    text: `Saw your post. I used to waste the first hour of every day planning.\n\nSo I built something that takes your task list and turns it into a proper time-blocked calendar schedule in seconds.`
  },
];

// ─── SCORING (same as before) ────────────────────────────────────────────────
function scoreLead(p) {
  const preScore = parseInt(p.score || "0");
  const product = (p.product || "LOCKEDIN").toUpperCase();

  if (preScore > 0 && (product === "DEVHIRE" || product === "TRADINGBOT")) return preScore;

  let score = 0;
  const leadType = (p.leadType || "").toUpperCase();

  if (product === "TRADINGBOT") score += 70;
  if (product === "DEVHIRE") score += 50;
  if (product === "LOCKEDIN") score += 25;

  if (leadType === "DEV_HIRE_URGENT") score += 30;
  if (leadType === "DEV_HIRE_SUBREDDIT") score += 20;
  if (leadType === "TRADING_BOT") score += 40;
  if (leadType === "LOCKEDIN_INTENT") score += 20;

  return score;
}

// ─── INBOX + OUTREACH LOGIC (kept mostly the same) ───────────────────────────
async function checkInbox() {
  // ... (keep your existing inbox logic — it's solid)
}

async function runOutreachCycle() {
  const leads = await loadLeads();
  if (!leads.length) return;

  const seen = new Set();
  const deduped = leads.filter(p => {
    const k = (p.username || "").toLowerCase().trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  deduped.sort((a, b) => scoreLead(b) - scoreLead(a));

  const users = loadUsers();
  const target = MIN_DMS_PER_CYCLE + Math.floor(Math.random() * (MAX_DMS_PER_CYCLE - MIN_DMS_PER_CYCLE + 1));
  let attempted = 0, sent = 0;

  const MIN_SCORE = 60; // New quality gate

  for (const post of deduped) {
    if (attempted >= target) break;

    const username = (post.username || "").trim();
    if (!username) continue;

    const key = username.toLowerCase();
    const user = getUser(users, username);
    if (user?.sent || user?.closed) continue;

    const leadScore = scoreLead(post);
    if (leadScore < MIN_SCORE) continue;

    attempted++;

    let message, tplId, subject;
    const product = (post.product || "LOCKEDIN").toUpperCase();

    if (product === "TRADINGBOT") {
      const tpl = pick(TRADINGBOT_MESSAGES);
      message = tpl.text;
      tplId = tpl.id;
      subject = "saw your post";
    } else if (product === "DEVHIRE") {
      message = buildDevHireMessage(post);
      tplId = "DEVHIRE";
      subject = "available to help";
    } else {
      const tpl = pick(LOCKEDIN_MESSAGES);
      message = tpl.text;
      tplId = tpl.id;
      subject = "this might help";
    }

    try {
      await reddit.composeMessage({ to: username, subject, text: message });
      sent++;

      log("SENT", `u/${username} | ${tplId} | score:${leadScore}`);

      upsertUser(users, username, {
        username, product, sent: true, sent_at: new Date().toISOString(),
        template: tplId, replied: false, closed: false
      });

      await sentWriter.writeRecords([{
        time: new Date().toISOString(), username, templateId: tplId,
        subreddit: post.subreddit, leadType: post.leadType,
        trigger: post.matchedTrigger, url: post.url, product
      }]);

      if (attempted < target) {
        const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
        await sleep(delay);
      }
    } catch (err) {
      log("ERROR", `Failed to DM u/${username}: ${err.message}`);
    }
  }

  log("INFO", `Cycle complete — attempted: ${attempted}, sent: ${sent}`);
}

// ─── MAIN LOOP ───────────────────────────────────────────────────────────────
(async () => {
  console.log("ClientMagnet Outreach Bot — Improved Messaging (No Links)");
  setInterval(checkInbox, INBOX_POLL_MS);

  while (true) {
    console.log(`\n[${new Date().toLocaleString()}] Starting outreach cycle...`);
    await runOutreachCycle();
    const delay = (6 + Math.floor(Math.random() * 3)) * 60 * 1000;
    await sleep(delay);
  }
})();
