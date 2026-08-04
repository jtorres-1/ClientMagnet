// agency_bot.cjs — ClientMagnet DM Bot
// DEVHIRE + TRADINGBOT only. No lockedIn. DM sending only.
// scraper.cjs handles all lead generation. This file never scrapes.
//
// CHANGES IN THIS VERSION:
// - Removed the budgetLine claims ("your budget works for this" / "your
//   number works") from both message builders. These fired on any
//   non-empty Budget field regardless of the actual amount, promising
//   fit before any real scoping happened. Never confirm budget fit in
//   the first message — same standard used in every real conversation.
// - Replaced extractNeedPhrase()'s verbatim quote-back with a small
//   topic-word detector. Quoting the post's own text back in quotation
//   marks is a recognizable mail-merge pattern; a plain topic word
//   ("scraper," "bot," "site") reads as paraphrased, not templated, and
//   removes the risk of the old regex cutting off mid-word or mid-phrase.
// - Each category now has 3-4 structurally different message variants
//   (not just reworded versions of one shape), written in a plain,
//   casual register — lowercase openers, no formal closing question
//   every time, specific-but-brief proof lines instead of polished
//   category claims. Picked at random per send so the same lead type
//   doesn't always produce the same message skeleton.
// - templateId now reflects which specific variant was sent (e.g.
//   DH_AUTOMATION_2), not just the category, so replies can be traced
//   to the exact message that landed.
//
// STILL OPEN, NOT CHANGED HERE:
// - MIN/MAX_DMS_PER_CYCLE (60-80) is still high enough to itself read as
//   bot-like traffic to Reddit's spam detection, independent of how good
//   the message text is. Worth a separate decision on lowering this.

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

// See "STILL OPEN" note above — flagged, not changed in this pass.
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

// ─── TOPIC WORD DETECTION ──────────────────────────────────────────────────────
function extractTopicWord(title, selftext) {
  const t = `${title} ${selftext || ""}`.toLowerCase();
  if (/scraper|scraping/.test(t)) return "scraper";
  if (/\bbot\b/.test(t)) return "bot";
  if (/automation|automate/.test(t)) return "automation";
  if (/mobile app|ios|android/.test(t)) return "app";
  if (/dashboard/.test(t)) return "dashboard";
  if (/website|web app|platform/.test(t)) return "site";
  return "project";
}

// ─── DEVHIRE MESSAGE VARIANTS ──────────────────────────────────────────────────
function devHireAutomationVariants(topic) {
  return [
    { id: "DH_AUTOMATION_1", text: `hey, saw your post about the ${topic}. built something similar for a shop a few weeks back, few days turnaround usually. happy to give you a real price if you send over the details` },
    { id: "DH_AUTOMATION_2", text: `saw you're looking for something automated. i do this kind of build full time, can usually turn it around fast. what are you trying to get it to do exactly` },
    { id: "DH_AUTOMATION_3", text: `hey, this is exactly the kind of thing i build. want me to send a quick idea of cost once i know more about what you need` },
    { id: "DH_AUTOMATION_4", text: `saw your post, i can probably help with this. built a similar ${topic} recently for another client. what's the timeline looking like on your end` },
  ];
}

function devHirePlatformVariants(topic) {
  return [
    { id: "DH_PLATFORM_1", text: `hey, saw you're looking to get a ${topic} built. did something close to this for a print shop client not long ago. happy to talk through what you need` },
    { id: "DH_PLATFORM_2", text: `saw your post about the ${topic}. this is what i do, can give you a real number once i know more about the scope` },
    { id: "DH_PLATFORM_3", text: `hey, this looks like something i can help with. built a full platform for a client recently, similar idea. want to tell me more about what you're trying to build` },
  ];
}

function devHireGeneralVariants() {
  return [
    { id: "DH_GENERAL_1", text: `hey, saw your post. this is the kind of work i do full time, flat fee, no agency in between. want to tell me more about it` },
    { id: "DH_GENERAL_2", text: `saw you're looking for a developer. happy to take a look, what are you trying to get built` },
    { id: "DH_GENERAL_3", text: `hey, this seems like something i could help with. what's the project, and do you have a rough idea of scope` },
  ];
}

const urgencyAddOns = [
  " can start today if that helps.",
  " free to jump on this right away.",
  "",
];

function buildDevHireMessage(post) {
  const rawTitle = post.Title || "";
  const selftext = post.Selftext || "";
  const topic    = extractTopicWord(rawTitle, selftext);
  const leadType = (post['Lead Type'] || "").toUpperCase();
  const isUrgent = leadType === "DEV_HIRE_URGENT";

  const combined = `${rawTitle} ${selftext}`;
  let variants;
  if (/bot|automat|scrape/i.test(combined)) {
    variants = devHireAutomationVariants(topic);
  } else if (/website|web app|platform|app|dashboard/i.test(combined)) {
    variants = devHirePlatformVariants(topic);
  } else {
    variants = devHireGeneralVariants();
  }

  const chosen = pick(variants);
  const suffix = isUrgent ? pick(urgencyAddOns) : "";
  return { text: `${chosen.text}${suffix}`, templateId: chosen.id };
}

// ─── TRADINGBOT MESSAGE VARIANTS ───────────────────────────────────────────────
function tradingBotPropFirmVariants() {
  return [
    { id: "TB_PROPFIRM_1", text: `hey, saw your post. built one of these before, automated a strategy on a funded topstep account, handled entries and exits without me touching it. what's your setup` },
    { id: "TB_PROPFIRM_2", text: `saw you're looking to automate a prop firm strategy. done this exact thing before. what account are you running and what's the strategy look like` },
    { id: "TB_PROPFIRM_3", text: `hey, this is something i build regularly. want to walk me through your entries and exits, i can tell you what it'd take to automate it` },
  ];
}

function tradingBotForexVariants() {
  return [
    { id: "TB_FOREX_1", text: `hey, saw your post about automating your forex strategy. i connect bots straight to broker apis, you keep the edge, i handle the execution. what pairs are you trading` },
    { id: "TB_FOREX_2", text: `saw you're looking to automate a forex strategy. done a few of these. what's your entry logic look like` },
    { id: "TB_FOREX_3", text: `hey, this is exactly what i build. what broker are you on and what's the strategy` },
  ];
}

function tradingBotGeneralVariants() {
  return [
    { id: "TB_GENERAL_1", text: `hey, saw your post. i build bots for people who already have a working strategy, you keep the edge, i handle the automation. what's your setup` },
    { id: "TB_GENERAL_2", text: `saw you're trying to automate your trading. what exchange and what's the entry logic look like, i can tell you what it'd take` },
    { id: "TB_GENERAL_3", text: `hey, this is something i do a lot. want to walk me through your strategy` },
  ];
}

function buildTradingBotMessage(post) {
  const rawTitle = (post.Title || "").trim();
  const selftext = post.Selftext || "";
  const combined = `${rawTitle} ${selftext}`;

  let variants;
  if (/prop firm|topstep|apex|ftmo|combine/i.test(combined)) {
    variants = tradingBotPropFirmVariants();
  } else if (/forex|eur|gbp|usd/i.test(combined)) {
    variants = tradingBotForexVariants();
  } else {
    variants = tradingBotGeneralVariants();
  }

  const chosen = pick(variants);
  return { text: chosen.text, templateId: chosen.id };
}

// ─── SCORING ──────────────────────────────────────────────────────────────────
function scoreLead(p) {
  const preScore = parseInt(p.Score || "0");
  if (preScore > 0) return preScore;

  let score = 0;
  const product  = (p.Product  || "").toUpperCase();
  const leadType = (p['Lead Type'] || "").toUpperCase();

  if (product === "TRADINGBOT") score += 70;
  if (product === "DEVHIRE")    score += 50;
  if (leadType === "DEV_HIRE_URGENT")    score += 30;
  if (leadType === "DEV_HIRE_SUBREDDIT") score += 20;
  if (leadType === "DEV_HIRE_TAGGED")    score += 25;
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
      const existing = getUser(users, item.author.name);
      const sentTemplate = existing?.template || "unknown";

      if (replyType === "NEGATIVE") {
        log("REPLY_NEG", `u/${item.author.name} — not interested | template:${sentTemplate}`);
        upsertUser(users, item.author.name, {
          replied: true, reply_type: "NEGATIVE",
          closed: true, closed_reason: "not_interested"
        });
      } else if (replyType === "POSITIVE") {
        log("HOT_LEAD", `\n${"=".repeat(60)}\nHOT LEAD — CHECK REDDIT NOW\nu/${item.author.name}: "${item.body.slice(0, 200)}"\ntemplate that landed: ${sentTemplate}\n${"=".repeat(60)}`);
        upsertUser(users, item.author.name, {
          replied: true, reply_type: "POSITIVE",
          reply_body: item.body.slice(0, 500), closed: false
        });
      } else {
        log("REPLY_UNCLEAR", `u/${item.author.name} replied — REVIEW MANUALLY | template:${sentTemplate}\n"${item.body.slice(0, 200)}"`);
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
    const k = (p.Username || "").trim().toLowerCase();
    if (!k || seenUsernames.has(k)) return false;
    seenUsernames.add(k);
    return true;
  });

  deduped.sort((a, b) => scoreLead(b) - scoreLead(a));

  const target    = MIN_DMS_PER_CYCLE + Math.floor(Math.random() * (MAX_DMS_PER_CYCLE - MIN_DMS_PER_CYCLE + 1));
  const cycleSeen = new Set();
  let attempted = 0, confirmed = 0, skippedNoMoney = 0;

  for (const post of deduped) {
    if (attempted >= target) { log("INFO", `Cycle target reached (${target} DMs).`); break; }

    const username  = (post.Username || "").trim();
    const url       = (post.URL      || "").trim();
    const product   = (post.Product  || "").trim().toUpperCase();
    const leadType  = (post['Lead Type'] || "").trim().toUpperCase();
    const subreddit = (post.Subreddit || "").trim();
    const trigger   = (post['Matched Trigger'] || "").trim();
    const moneySignal = (post['Money Signal'] || "").trim().toUpperCase();

    if (!username) continue;
    if (cycleSeen.has(username.toLowerCase())) continue;
    if (product !== "DEVHIRE" && product !== "TRADINGBOT") continue;

    if (moneySignal === "NO") {
      skippedNoMoney++;
      log("SKIP_NO_MONEY", `u/${username}`);
      continue;
    }

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

    let built, subject;
    if (product === "TRADINGBOT") {
      built = buildTradingBotMessage(post);
      subject = "saw your post";
    } else {
      built = buildDevHireMessage(post);
      subject = leadType === "DEV_HIRE_URGENT" ? "available now" : "saw your post";
    }
    const { text: tplText, templateId: tplId } = built;

    try {
      const freshUsers = loadUsers();
      const freshUser  = getUser(freshUsers, username);
      if (freshUser?.sent) { log("SKIP", `u/${username} already sent (fresh check)`); continue; }

      await reddit.composeMessage({ to: username, subject, text: tplText });
      confirmed++;
      log("SENT", `u/${username} | ${tplId} | [${product}] | score:${score} | money:${moneySignal || "unknown"}`);

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

  log("INFO", `Cycle complete — attempted: ${attempted}, confirmed: ${confirmed}, skipped_no_money: ${skippedNoMoney}`);
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────
(async () => {
  console.log("=".repeat(60));
  console.log("ClientMagnet DM Bot — DEVHIRE + TRADINGBOT — varied casual messaging");
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
