// agency_bot.cjs — DevHire + lockedIn + TradingBot Outreach
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
    { id: "time",       title: "Time" },
    { id: "username",   title: "Username" },
    { id: "templateId", title: "Template ID" },
    { id: "subreddit",  title: "Subreddit" },
    { id: "leadType",   title: "Lead Type" },
    { id: "trigger",    title: "Matched Trigger" },
    { id: "url",        title: "Post URL" },
    { id: "product",    title: "Product" },
  ],
  append: true
});

function log(tag, msg) { console.log(`[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ─── REPLY CLASSIFICATION ────────────────────────────────────────────────────
const positiveReplyRegex = /\b(interested|tell me more|how does it work|how much|what's the price|what is the price|sounds good|yes|yeah|sure|how do i|sign me up|i want|send me|where do i|how do i get|let's do it|lets do it|can you|would this work|does it work for|more info|more information|what do you|how does|can i see|show me|demo|trial|how to get started|getting started|i'd like|i would like|this looks|this sounds|great|awesome|nice|cool|exactly what|been looking for|need this)\b/i;

const negativeReplyRegex = /\b(not interested|no thanks|no thank you|stop messaging|stop dming|don't message|do not message|remove me|unsubscribe|leave me alone|wrong person|not for me|not relevant|spam|reported|i'm good|im good|i'm all set|im all set|already have|don't need|do not need|not looking|not right now|maybe later|no need|pass|nope|nah|go away|f off|piss off|scam|bot)\b/i;

function classifyReply(text) {
  const t = (text || "").toLowerCase();
  if (negativeReplyRegex.test(t)) return "NEGATIVE";
  if (positiveReplyRegex.test(t)) return "POSITIVE";
  return "UNCLEAR";
}

// ─── DEVHIRE MESSAGE BUILDER ──────────────────────────────────────────────────
function buildDevHireMessage(post) {
  const title = (post.title || "").replace(/^\[.*?\]\s*/i, "").trim();
  const budget = (post.budget || "").trim();
  const leadType = (post.leadType || "").toUpperCase();
  const isUrgent = leadType === "DEV_HIRE_URGENT";

  const budgetLine = budget ? `\n\nbudget looks like ${budget}, works for me.` : "";
  const urgentLine = isUrgent ? " can start immediately." : " can have it done in 48 hours.";

  const openers = [
    `saw your post about ${title.toLowerCase().slice(0, 80)}.`,
    `your post about ${title.toLowerCase().slice(0, 80)} caught my eye.`,
    `just saw your post about ${title.toLowerCase().slice(0, 80)}.`,
  ];

  const bodies = [
    `i build exactly this kind of thing. recent work: reddit dm automation SaaS ([autosub.online](https://autosub.online)), google maps lead scraper ([mapzap.org](https://mapzap.org)), custom booking bot for a logistics company in saudi arabia.`,
    `this is in my wheelhouse. i've shipped a reddit outreach bot ([autosub.online](https://autosub.online)), a google maps scraper with email lookup ([mapzap.org](https://mapzap.org)), and a multi-account booking automation for a client overseas.`,
    `i've built similar things. live projects: [autosub.online](https://autosub.online) (reddit automation SaaS), [mapzap.org](https://mapzap.org) (google maps lead scraper), custom booking bot for a logistics company.`,
  ];

  const closes = [
    `flat fee, no hourly.${urgentLine}${budgetLine}\n\nwhat are the full details?`,
    `flat fee, delivered fast.${urgentLine}${budgetLine}\n\ndm me the scope and i'll give you a quote today.`,
    `flat fee only.${urgentLine}${budgetLine}\n\nwhat do you need built exactly?`,
  ];

  return `${pick(openers)}\n\n${pick(bodies)}\n\n${pick(closes)}`;
}

// ─── TRADING BOT MESSAGES ─────────────────────────────────────────────────────
const TRADINGBOT_MESSAGES = [
  {
    id: "TB_1",
    text: `saw your post. i build custom trading bots for people running real strategies.\n\ni recently built a live futures bot that ran on a funded Topstep account using the ProjectX API. paper trading mode, live execution, position sizing, all included.\n\nwhat exchange and strategy are you working with?`
  },
  {
    id: "TB_2",
    text: `saw your post. automating trading strategies is what i do.\n\nrecent build: a fully automated futures bot running on a funded account. handles entries, exits, position sizing, and risk limits. flat fee, you get a working bot.\n\nwhat are you trying to automate?`
  },
  {
    id: "TB_3",
    text: `saw your post. i build trading bots for people who have a strategy and want it running automatically.\n\nlive example: futures bot on a Topstep funded account, built in Python, connected to the exchange API directly. no third party tools, no subscriptions.\n\nwhat does your setup look like?`
  },
  {
    id: "TB_4",
    text: `saw your post. if you have a strategy that works manually and you want it automated, that's exactly what i build.\n\ni've shipped a live futures bot on a funded account and custom automation for several trading setups. flat fee, delivered fast.\n\nwhat exchange are you on and what's the strategy?`
  },
  {
    id: "TB_5",
    text: `saw your post. i specialize in custom trading bot development.\n\nrecent work includes a live automated futures bot on a funded Topstep combine using ProjectX API. built in Python, handles full trade lifecycle.\n\ntell me about your strategy and what you want automated.`
  },
];

// ─── LOCKEDIN MESSAGES ────────────────────────────────────────────────────────
const LOCKEDIN_MESSAGES = [
  {
    id: "LI_1",
    text: `saw your post. i had the same problem so i built something\n\nyou type your tasks for the day in any order, ai schedules your whole day and sends it straight to your calendar. takes about 10 seconds\n\nfree to try at [flowmate.live](https://flowmate.live)`
  },
  {
    id: "LI_2",
    text: `saw your post. i built something that might actually help\n\ndump all your tasks in any order, ai figures out the timing and order and adds a full time-blocked schedule to your calendar automatically. one tap, done\n\nfree to try at [flowmate.live](https://flowmate.live)`
  },
  {
    id: "LI_3",
    text: `saw your post. i built an ai scheduler that does this\n\ntype everything you need to do today, it builds a realistic time-blocked schedule and sends it to your calendar. no dragging, no planning, just your tasks in and your day sorted\n\nfree to try at [flowmate.live](https://flowmate.live)`
  },
  {
    id: "LI_4",
    text: `saw your post. this is exactly why i built lockedin\n\nyou dump your tasks, ai schedules your entire day and it goes straight into your calendar. the planning part takes 10 seconds\n\nfree at [flowmate.live](https://flowmate.live)`
  },
  {
    id: "LI_5",
    text: `saw your post. i used to lose the first hour of every day to this exact thing\n\nbuilt an ai that takes your task list and turns it into a time-blocked calendar schedule automatically. works with any calendar app\n\nfree to try at [flowmate.live](https://flowmate.live)`
  }
];

// ─── SCORING ──────────────────────────────────────────────────────────────────
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

// ─── LEAD LOADER ─────────────────────────────────────────────────────────────
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

// ─── INBOX HANDLER ───────────────────────────────────────────────────────────
async function checkInbox() {
  const botUsername = (process.env.REDDIT_USERNAME || "").toLowerCase();
  try {
    const unread = await reddit.getUnreadMessages({ limit: 50 });
    const toMarkRead = [];

    for (const item of unread) {
      if (item.was_comment !== false) continue;
      if (!item.body || !item.author) continue;
      toMarkRead.push(item);

      const sender = item.author.name.toLowerCase();
      if (sender === botUsername) continue;

      const replyType = classifyReply(item.body);
      const users = loadUsers();

      if (replyType === "NEGATIVE") {
        log("REPLY_NEG", `u/${item.author.name} not interested`);
        upsertUser(users, item.author.name, {
          replied: true, reply_type: "NEGATIVE",
          closed: true, closed_reason: "not_interested"
        });
      } else if (replyType === "POSITIVE") {
        log("HOT_LEAD", `\n${"=".repeat(60)}\nHOT LEAD — CHECK YOUR REDDIT INBOX NOW\nu/${item.author.name} replied with interest\nMessage: "${item.body.slice(0, 200)}"\n${"=".repeat(60)}`);
        upsertUser(users, item.author.name, {
          replied: true, reply_type: "POSITIVE",
          reply_body: item.body.slice(0, 500), closed: false
        });
      } else {
        log("REPLY_UNCLEAR", `u/${item.author.name} replied — REVIEW MANUALLY\nMessage: "${item.body.slice(0, 200)}"`);
        upsertUser(users, item.author.name, {
          replied: true, reply_type: "UNCLEAR",
          reply_body: item.body.slice(0, 500), closed: false
        });
      }
    }

    if (toMarkRead.length > 0) {
      for (let i = 0; i < toMarkRead.length; i += 25) {
        const chunk = toMarkRead.slice(i, i + 25);
        try {
          await reddit.markMessagesAsRead(chunk);
          log("INFO", `Marked ${chunk.length} message(s) as read`);
        } catch (err) {
          log("WARN", `markMessagesAsRead failed: ${err.message}`);
        }
      }
    }
  } catch (err) {
    log("ERROR", `Inbox check failed: ${err.message}`);
  }
}

// ─── OUTREACH CYCLE ──────────────────────────────────────────────────────────
async function runOutreachCycle() {
  const leads = await loadLeads();
  if (!leads.length) { log("INFO", "No leads found."); return; }

  const seenUsernames = new Set();
  const dedupedLeads = leads.filter(p => {
    const k = (p.username || "").trim().toLowerCase();
    if (!k || seenUsernames.has(k)) return false;
    seenUsernames.add(k);
    return true;
  });
  dedupedLeads.sort((a, b) => scoreLead(b) - scoreLead(a));

  const users      = loadUsers();
  const target     = MIN_DMS_PER_CYCLE + Math.floor(Math.random() * (MAX_DMS_PER_CYCLE - MIN_DMS_PER_CYCLE + 1));
  const cyclesSeen = new Set();
  let attempted = 0, confirmed = 0;

  for (const post of dedupedLeads) {
    if (attempted >= target) { log("INFO", `Cycle target reached (${target} DMs).`); break; }

    const username  = (post.username || "").trim();
    const url       = (post.url      || "").trim();
    const trigger   = (post.matchedTrigger || "").trim();
    const leadType  = (post.leadType || "").trim().toUpperCase();
    const subreddit = (post.subreddit || "").trim();
    const product   = (post.product || "LOCKEDIN").trim().toUpperCase();

    if (!username || !url) continue;
    const key  = username.toLowerCase();
    const user = getUser(users, username);

    if (cyclesSeen.has(key)) continue;
    if (user?.sent) { log("SKIP", `already contacted u/${username}`); continue; }
    if (user?.closed) { log("SKIP", `closed u/${username}`); continue; }

    cyclesSeen.add(key);
    attempted++;

    let tplText, tplId, subject;

    if (product === "TRADINGBOT") {
      const tpl = pick(TRADINGBOT_MESSAGES);
      tplText = tpl.text;
      tplId = tpl.id;
      subject = "saw your post";
    } else if (product === "DEVHIRE") {
      tplText = buildDevHireMessage(post);
      tplId = leadType === "DEV_HIRE_URGENT" ? "DH_URGENT_CONTEXT" : "DH_CONTEXT";
      subject = leadType === "DEV_HIRE_URGENT" ? "available now" : "saw your post";
    } else if (product === "LOCKEDIN") {
      const tpl = pick(LOCKEDIN_MESSAGES);
      tplText = tpl.text;
      tplId = tpl.id;
      subject = "this might help";
    } else {
      const tpl = pick(LOCKEDIN_MESSAGES);
      tplText = tpl.text;
      tplId = tpl.id;
      subject = "this might help";
    }

    try {
      const freshUser = getUser(loadUsers(), username);
      if (freshUser?.sent) {
        log("SKIP", `already contacted u/${username} (fresh check)`);
        continue;
      }

      await reddit.composeMessage({ to: username, subject, text: tplText });
      confirmed++;
      log("SENT", `u/${username} | ${tplId} | [${product}/${leadType}] | score:${scoreLead(post)} | budget:${post.budget||"unknown"}`);

      upsertUser(users, username, {
        username, product, leadType,
        sent: true, sent_at: new Date().toISOString(), template: tplId,
        replied: false, reply_type: null, reply_body: null,
        closed: false, closed_reason: null,
        trigger, url, subreddit
      });

      await sentWriter.writeRecords([{
        time: new Date().toISOString(), username, templateId: tplId,
        subreddit, leadType, trigger, url, product
      }]);

      if (attempted < target) {
        const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
        log("INFO", `Waiting ${Math.round(delay/1000)}s before next DM...`);
        await sleep(delay);
      }
    } catch (err) {
      log("ERROR", `DM failed u/${username}: ${err.message}`);
      if (/NOT_WHITELISTED|USER_DOESNT_EXIST|BANNED/.test(err.message)) {
        upsertUser(users, username, { username, sent: false, closed: true, closed_reason: "blocked_or_banned" });
      }
    }
  }

  log("INFO", `Outreach cycle complete attempted ${attempted}, confirmed ${confirmed}`);
}

// ─── MAIN LOOP ───────────────────────────────────────────────────────────────
(async () => {
  console.log("=".repeat(60));
  console.log("ClientMagnet — DevHire + TradingBot + lockedIn Outreach Bot");
  console.log("=".repeat(60));

  setInterval(checkInbox, INBOX_POLL_MS);

  while (true) {
    console.log(`\n[${new Date().toLocaleString()}] Starting outreach cycle...`);
    await runOutreachCycle();
    const cycleDelay = (6 + Math.floor(Math.random() * 3)) * 60 * 1000;
    log("INFO", `Next cycle in ${Math.round(cycleDelay/60000)} minutes...`);
    await sleep(cycleDelay);
  }
})();
