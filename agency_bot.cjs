// agency_bot.cjs — ClientMagnet DM Bot (v4 — no generic post-reference openers)
// v4: removed "saw your post" / "checked out your post" openers permanently.
// Recipients kept replying confused since the opener never said what post,
// so every message now opens by referencing the actual pain phrase or topic
// directly instead of a generic pointer to "your post."

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

const MIN_DMS_PER_CYCLE = 25;
const MAX_DMS_PER_CYCLE = 40;
const MIN_DELAY_MS      = 45 * 1000;
const MAX_DELAY_MS      = 90 * 1000;
const INBOX_POLL_MS     = 60 * 1000;
const MIN_SCORE_TO_DM   = 60;

const LINKEDIN_URL  = "https://www.linkedin.com/in/jesse-torres11/";
const INSTAGRAM_URL = "https://www.instagram.com/jtx_ai/";

// Banned forever. Never use these to open a message, even accidentally
// through a template edit. Every send is checked against this before going out.
const BANNED_OPENERS = [
  /\bsaw your post\b/i,
  /\bsaw what you said\b/i,
  /\bchecked out your post\b/i,
  /\bcame across your post\b/i,
];

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
    { id: "vertical",   title: "Vertical" },
    { id: "url",        title: "Post URL" },
    { id: "score",      title: "Score" },
  ],
  append: true,
});

function log(tag, msg) { console.log(`[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const positiveReplyRegex = /\b(interested|tell me more|how does it work|how much|what's the price|sounds good|yes|yeah|sure|how do i|sign me up|i want|send me|where do i|let's do it|can you|would this work|more info|demo|i'd like|this looks|this sounds|great|awesome|exactly what|been looking for|need this|what would|what do you|what's included|how long|timeline)\b/i;
const negativeReplyRegex = /\b(not interested|no thanks|stop messaging|stop dming|remove me|leave me alone|wrong person|not for me|not relevant|spam|reported|i'm good|already have|don't need|not looking|pass|nope|nah|scam|bot)\b/i;

function classifyReply(text) {
  const t = (text || "").toLowerCase();
  if (negativeReplyRegex.test(t)) return "NEGATIVE";
  if (positiveReplyRegex.test(t)) return "POSITIVE";
  return "UNCLEAR";
}

function proofLine() {
  const options = [
    "", "", "", "", "",
    `here's my linkedin if it helps, ${LINKEDIN_URL}`,
    `i post real client builds on instagram if you want examples, ${INSTAGRAM_URL}`,
    `happy to share proof of past work, linkedin here ${LINKEDIN_URL}`,
    `you can check my instagram for examples of what i've built, ${INSTAGRAM_URL}`,
  ];
  return pick(options);
}
function withProof(base) {
  const proof = proofLine();
  return proof ? `${base}. ${proof}` : base;
}

// Every opener names the actual thing they described instead of pointing
// back at "your post." Falls back to the vertical topic if no pain phrase
// was extracted, never falls back to a generic post reference.
function ecommerceVariants(pain) {
  const topic = pain || "the manual side of running the store";
  return [
    { id: "ECOM_1", text: withProof(`hey, ${topic}, that's exactly the kind of thing i build automation for. happy to give you a real idea of what it'd take`) },
    { id: "ECOM_2", text: withProof(`hey, that kind of manual tracking eats way more time than people realize. i build tools for exactly this, what platform are you selling on`) },
    { id: "ECOM_3", text: withProof(`hey, this is the kind of thing i automate for sellers. what's it currently costing you time wise, and what would you want it to do instead`) },
  ];
}
function localServiceVariants(pain) {
  const topic = pain || "keeping up with it manually";
  return [
    { id: "LOCAL_1", text: withProof(`hey, ${topic}, i build scheduling and tracking automation for service businesses, happy to take a look at what you need`) },
    { id: "LOCAL_2", text: withProof(`hey, that's exactly the kind of manual work i help businesses automate. what's the process look like right now`) },
    { id: "LOCAL_3", text: withProof(`hey, this is something i build for shops like yours. what are you currently doing by hand that's eating the most time`) },
  ];
}
function propertyVariants(pain) {
  const topic = pain || "managing this manually";
  return [
    { id: "PROP_1", text: withProof(`hey, ${topic}, i build automation for property management, tenant and maintenance tracking, that kind of thing. what's the current setup`) },
    { id: "PROP_2", text: withProof(`hey, that's a common pain point for landlords managing this by hand. happy to take a look at what you need automated`) },
    { id: "PROP_3", text: withProof(`hey, this is something i build. how many units are we talking, and what's eating the most time right now`) },
  ];
}
function generalVariants(pain) {
  const topic = pain || "the manual work you mentioned";
  return [
    { id: "GEN_1", text: withProof(`hey, ${topic}, i build automation for businesses dealing with exactly this. what's the process look like`) },
    { id: "GEN_2", text: withProof(`hey, happy to take a look at this. what are you currently doing manually that you'd want automated`) },
  ];
}

function violatesBannedOpener(text) {
  return BANNED_OPENERS.some(rx => rx.test(text));
}

function buildMessage(lead) {
  const vertical = (lead.Vertical || "general").toLowerCase();
  const pain = (lead["Pain Phrase"] || "").trim();
  let variants;
  if (vertical === "ecommerce") variants = ecommerceVariants(pain);
  else if (vertical === "local_service") variants = localServiceVariants(pain);
  else if (vertical === "property_mgmt") variants = propertyVariants(pain);
  else variants = generalVariants(pain);

  // Filter out any variant that somehow matches a banned opener before
  // picking, this is the hard stop, not just a style preference.
  const safeVariants = variants.filter(v => !violatesBannedOpener(v.text));
  const chosen = pick(safeVariants.length ? safeVariants : generalVariants(""));
  return { text: chosen.text, templateId: chosen.id };
}

function scoreLead(p) { return parseInt(p.Score || "0") || 0; }

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
        log("REPLY_NEG", `u/${item.author.name} not interested | template:${sentTemplate}`);
        upsertUser(users, item.author.name, { replied: true, reply_type: "NEGATIVE", closed: true, closed_reason: "not_interested" });
      } else if (replyType === "POSITIVE") {
        log("HOT_LEAD", `HOT LEAD u/${item.author.name}: "${item.body.slice(0, 200)}" template:${sentTemplate}`);
        upsertUser(users, item.author.name, { replied: true, reply_type: "POSITIVE", reply_body: item.body.slice(0, 500), closed: false });
      } else {
        log("REPLY_UNCLEAR", `u/${item.author.name} replied, review manually | template:${sentTemplate}`);
        upsertUser(users, item.author.name, { replied: true, reply_type: "UNCLEAR", reply_body: item.body.slice(0, 500), closed: false });
      }
    }
    if (toMarkRead.length > 0) {
      for (let i = 0; i < toMarkRead.length; i += 25) {
        try { await reddit.markMessagesAsRead(toMarkRead.slice(i, i + 25)); }
        catch (err) { log("WARN", `markMessagesAsRead failed: ${err.message}`); }
      }
    }
  } catch (err) {
    log("ERROR", `Inbox check failed: ${err.message}`);
  }
}

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

  const target = MIN_DMS_PER_CYCLE + Math.floor(Math.random() * (MAX_DMS_PER_CYCLE - MIN_DMS_PER_CYCLE + 1));
  const cycleSeen = new Set();
  let attempted = 0, confirmed = 0;

  for (const lead of deduped) {
    if (attempted >= target) { log("INFO", `Cycle target reached (${target} DMs).`); break; }
    const username = (lead.Username || "").trim();
    if (!username) continue;
    if (cycleSeen.has(username.toLowerCase())) continue;

    const users = loadUsers();
    const user = getUser(users, username);
    if (user?.sent || user?.closed) { log("SKIP", `already contacted u/${username}`); continue; }

    const score = scoreLead(lead);
    if (score < MIN_SCORE_TO_DM) { log("SKIP", `u/${username} score ${score} below ${MIN_SCORE_TO_DM}`); continue; }

    cycleSeen.add(username.toLowerCase());
    attempted++;
    const { text: tplText, templateId: tplId } = buildMessage(lead);

    // Hard stop, never send if a banned opener somehow made it through.
    if (violatesBannedOpener(tplText)) {
      log("BLOCKED", `u/${username} message blocked, contained a banned opener`);
      continue;
    }

    try {
      const freshUsers = loadUsers();
      if (getUser(freshUsers, username)?.sent) { log("SKIP", `u/${username} already sent`); continue; }

      await reddit.composeMessage({ to: username, subject: "quick question", text: tplText });
      confirmed++;
      log("SENT", `u/${username} | ${tplId} | vertical:${lead.Vertical} | score:${score}`);

      upsertUser(freshUsers, username, {
        username, vertical: lead.Vertical,
        sent: true, sent_at: new Date().toISOString(), template: tplId,
        replied: false, reply_type: null, reply_body: null,
        closed: false, closed_reason: null,
        url: lead.URL, subreddit: lead.Subreddit, score,
      });

      await sentWriter.writeRecords([{
        time: new Date().toISOString(), username, templateId: tplId,
        subreddit: lead.Subreddit, vertical: lead.Vertical, url: lead.URL, score,
      }]);

      if (attempted < target) {
        const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
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
  log("INFO", `Cycle complete, attempted: ${attempted}, confirmed: ${confirmed}`);
}

(async () => {
  console.log("ClientMagnet DM Bot v4 — no generic post-reference openers");
  setInterval(checkInbox, INBOX_POLL_MS);
  while (true) {
    await runOutreachCycle();
    const delay = (6 + Math.floor(Math.random() * 3)) * 60 * 1000;
    log("INFO", `Next cycle in ${Math.round(delay / 60000)} minutes...`);
    await sleep(delay);
  }
})();
