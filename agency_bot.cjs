// agency_bot.cjs — ClientMagnet DM Bot
// DEVHIRE + TRADINGBOT only. No lockedIn. DM sending only.
// scraper.cjs handles all lead generation. This file never scrapes.
//
// CHANGES IN THIS VERSION:
// - buildDevHireMessage() and buildTradingBotMessage() now pull the actual
//   need from post title + selftext instead of swapping in a lowercased title
//   fragment into a fixed template. Proof point matches what they asked for.
// - Removed the static TRADINGBOT_MESSAGES rotation, replaced with
//   buildTradingBotMessage(post) so every trading bot DM is personalized too.
// - Hard skip on Money Signal === NO from the CSV, on top of the score check.
// - Template id is now a short signature string instead of a fixed pool id,
//   so replies can be traced back to what got sent, not just which pool.

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

// ─── REPLY CLASSIFICATION ─────────────────────────────────────────────────────
const positiveReplyRegex = /\b(interested|tell me more|how does it work|how much|what's the price|what is the price|sounds good|yes|yeah|sure|how do i|sign me up|i want|send me|where do i|let's do it|lets do it|can you|would this work|more info|more information|demo|trial|how to get started|i'd like|i would like|this looks|this sounds|great|awesome|exactly what|been looking for|need this|what would|what do you|what's your|what's included|how long|timeline|what exchange|what platform|tell me)\b/i;

const negativeReplyRegex = /\b(not interested|no thanks|no thank you|stop messaging|stop dming|don't message|do not message|remove me|leave me alone|wrong person|not for me|not relevant|spam|reported|i'm good|im good|i'm all set|im all set|already have|don't need|not looking|not right now|pass|nope|nah|go away|scam|bot)\b/i;

function classifyReply(text) {
  const t = (text || "").toLowerCase();
  if (negativeReplyRegex.test(t)) return "NEGATIVE";
  if (positiveReplyRegex.test(t)) return "POSITIVE";
  return "UNCLEAR";
}

// ─── EXTRACT SPECIFIC NEED FROM POST TEXT ─────────────────────────────────────
// Pulls the clause that matched intent so it can be referenced directly in
// the DM body, instead of reusing a lowercased title fragment everywhere.
function extractNeedPhrase(title, selftext) {
  const text = `${title} ${selftext || ""}`;
  const patterns = [
    /\b(build|create|make|develop|code|automate|scrape)\b[^.!?]{0,80}/i,
    /\bneed[^.!?]{0,80}/i,
    /\blooking for[^.!?]{0,80}/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0].trim().replace(/\s+/g, " ");
  }
  return (title || "").replace(/^\[.*?\]\s*/i, "").trim();
}

// ─── DEVHIRE MESSAGE (personalized) ───────────────────────────────────────────
function buildDevHireMessage(post) {
  const rawTitle   = (post.Title || "").replace(/^\[.*?\]\s*/i, "").trim();
  const selftext   = post.Selftext || "";
  const needPhrase = extractNeedPhrase(post.Title, selftext);
  const budget     = (post.Budget || "").trim();
  const leadType   = (post['Lead Type'] || "").toUpperCase();
  const isUrgent   = leadType === "DEV_HIRE_URGENT";
  const isTagged   = leadType === "DEV_HIRE_TAGGED";

  const opener = isTagged
    ? `saw your task post, specifically "${needPhrase}."`
    : `saw your post, you mentioned needing "${needPhrase}."`;

  let proof, sig;
  if (/bot|automat|scrape/i.test(rawTitle + selftext)) {
    proof = `I build exactly this, custom bots and automation. Recent one was a lead scraper with automated outreach built for a business with a similar setup.`;
    sig = "DH_AUTOMATION";
  } else if (/website|web app|platform|app|dashboard/i.test(rawTitle + selftext)) {
    proof = `I build exactly this. Recent build was a full ordering platform for a print shop client, live product selection, order tracking, owner dashboard.`;
    sig = "DH_PLATFORM";
  } else {
    proof = `This is the kind of work I do full time, custom builds, flat fee, no agency markup.`;
    sig = "DH_GENERAL";
  }

  const timing = isUrgent ? " Can start today." : " Can turn this around in 48 hours.";
  const budgetLine = budget ? ` Your budget works for this.` : "";
  const close = `${timing}${budgetLine} Want me to send a quick breakdown of how I'd build it and a flat price?`;

  const text = `${opener}\n\n${proof}\n\n${close}`;
  const templateId = `${sig}${isUrgent ? "_URGENT" : ""}`;
  return { text, templateId };
}

// ─── TRADINGBOT MESSAGE (personalized) ────────────────────────────────────────
function buildTradingBotMessage(post) {
  const rawTitle   = (post.Title || "").trim();
  const selftext   = post.Selftext || "";
  const needPhrase = extractNeedPhrase(post.Title, selftext);
  const budget     = (post.Budget || "").trim();

  const opener = `saw your post about "${needPhrase}."`;

  let proof, sig;
  if (/prop firm|topstep|apex|ftmo|combine/i.test(rawTitle + selftext)) {
    proof = `I've done this exact setup before, automated a strategy for a funded prop account. Handles entries, exits, and drawdown protection without manual execution.`;
    sig = "TB_PROPFIRM";
  } else if (/forex|eur|gbp|usd/i.test(rawTitle + selftext)) {
    proof = `I build execution bots connected directly to broker APIs for forex strategies. You keep the edge, I handle the infrastructure.`;
    sig = "TB_FOREX";
  } else {
    proof = `I build custom execution bots for people who already have a working strategy. Live example, an automated futures bot running on a funded Topstep account, entries, exits, and risk rules all hands off.`;
    sig = "TB_GENERAL";
  }

  const budgetLine = budget ? ` Your number works.` : "";
  const close = `Flat fee, you own the code outright.${budgetLine} What's your exchange and entry logic, want me to tell you exactly how I'd build it?`;

  const text = `${opener}\n\n${proof}\n\n${close}`;
  return { text, templateId: sig };
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

    // Hard skip if the scraper explicitly flagged no money signal.
    // UNKNOWN is allowed through (LLM was unavailable at scrape time),
    // only an explicit NO is blocked here.
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
      log("SENT", `u/${username} | ${tplId} | [${product}] | score:${score} | budget:${post.Budget || "unknown"} | money:${moneySignal || "unknown"}`);

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
  console.log("ClientMagnet DM Bot — DEVHIRE + TRADINGBOT — personalized copy + money filter");
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
