// agency_bot.cjs -- ClientMagnet Business Outreach
// Product: AI Voice Agent / CallDone for any business ($500/mo) -- auto close via link
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

const baseDir = path.resolve(__dirname, "logs");
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

const leadsPath = path.join(baseDir, "clean_leads.csv");
const sentPath  = path.join(baseDir, "clean_leads_dmed.csv");
const usersPath = path.join(baseDir, "contacted_users.json");

const MIN_DMS_PER_CYCLE = 15;
const MAX_DMS_PER_CYCLE = 25;
const MIN_DELAY_MS      = 3 * 60 * 1000;
const MAX_DELAY_MS      = 5 * 60 * 1000;
const INBOX_POLL_MS     = 60 * 1000;
const FOLLOWUP_MIN_MS   = 10 * 1000;
const FOLLOWUP_MAX_MS   = 30 * 1000;

const NEGATIVE_SIGNALS = [
  "not interested","stop","leave me alone","no thanks","no thank you",
  "unsubscribe","remove me","don't message","do not message","spam","reported","block"
];

function isNegativeReply(body) {
  const b = (body || "").toLowerCase();
  return NEGATIVE_SIGNALS.some(s => b.includes(s));
}

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
    { id: "step", title: "Step" }, { id: "templateId", title: "Template ID" },
    { id: "subreddit", title: "Subreddit" }, { id: "leadType", title: "Lead Type" },
    { id: "trigger", title: "Matched Trigger" }, { id: "url", title: "Post URL" },
    { id: "product", title: "Product" }, { id: "note", title: "Note" },
  ],
  append: true
});

function log(tag, msg) { console.log(`[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* =========================
   VOICE AGENT (CALLDONE) TEMPLATES -- any business
========================= */
const VOICE_OPENERS = [
  { id: "V_O1", text: `saw your post about the phone situation -- quick question: how many calls would you say you miss in a week when you're busy with customers?` },
  { id: "V_O2", text: `noticed your post about missed calls -- honest question: roughly how many calls a week go to voicemail because you're tied up?` },
  { id: "V_O3", text: `saw your post about the phones -- are you using anything to handle calls when you can't get to them?` },
  { id: "V_O4", text: `noticed your post -- quick question: do you have anything answering your phone when you're with a customer or closed?` },
  { id: "V_O5", text: `saw your post about calls slipping through -- are you missing them or just running out of time to call back?` }
];

const VOICE_VALUE = [
  { id: "V_V1", text: `right -- every missed call is a customer someone else is getting\n\ni built an AI receptionist that picks up every call 24/7 -- books appointments, answers your FAQs, captures the lead info, and texts you a summary instantly so you never miss a thing` },
  { id: "V_V2", text: `yeah that's the thing -- you can't answer the phone when you're with a customer, and after-hours calls just disappear\n\ni built an AI that answers every call automatically. sounds like a real receptionist, books appointments, handles basic questions. you only deal with the ones that actually need you` },
  { id: "V_V3", text: `makes sense -- hiring a full-time receptionist is expensive, and answering services feel robotic and miss details\n\ni built an AI phone receptionist for small businesses. answers 24/7, books appointments, captures every lead. live on your number in 48 hours` }
];

const VOICE_CLOSE = [
  { id: "V_C1", text: () => `you can actually call the AI right now and hear it for yourself -- calldone.org has a live demo number. no commitment, just call it and see if it sounds right for your business` },
  { id: "V_C2", text: () => `i set up a live demo you can call right now -- calldone.org. hear exactly what your callers would hear. takes 2 minutes` },
  { id: "V_C3", text: () => `built a demo you can call right now to hear how it sounds -- calldone.org. if it sounds good, setup takes 48 hours and your phones are handled` }
];

/* =========================
   HELPERS
========================= */
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function getOpener() { return pick(VOICE_OPENERS); }
function getValueMsg() { return pick(VOICE_VALUE); }
function getCloseMsg() { return pick(VOICE_CLOSE); }

/* =========================
   LEAD SCORING
========================= */
function scoreLead(p) {
  let score = 0;
  const t = (p.matchedTrigger || "").toLowerCase();
  if (p.leadType === "CONFIRMED_BUSINESS_OWNER") score += 5;
  if (p.leadType === "GENERAL_BUSINESS_PAIN") score += 3;
  if (/missed calls|missing calls|losing customers|losing clients|losing bookings|losing leads/.test(t)) score += 4;
  if (/desperate|drowning|can't keep up|overwhelmed/.test(t)) score += 5;
  if (/need a receptionist|can't afford|too expensive|front desk/.test(t)) score += 4;
  if (["smallbusiness","Entrepreneur","restaurantowners","realtors","Dentistry","gymowners","AutoMechanic","salons","retail","eventplanning"].includes(p.subreddit)) score += 3;
  return score;
}

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

/* =========================
   OUTREACH CYCLE -- STEP 1
========================= */
async function runOutreachCycle() {
  const leads = await loadLeads();
  if (!leads.length) { log("INFO", "No leads found. Waiting for scraper..."); return; }

  leads.sort((a, b) => scoreLead(b) - scoreLead(a));

  const users      = loadUsers();
  const target     = MIN_DMS_PER_CYCLE + Math.floor(Math.random() * (MAX_DMS_PER_CYCLE - MIN_DMS_PER_CYCLE + 1));
  const cyclesSeen = new Set();
  let attempted = 0, confirmed = 0;

  for (const post of leads) {
    if (attempted >= target) { log("INFO", `Cycle target reached (${target} DMs).`); break; }

    const username  = (post.username || "").trim();
    const url       = (post.url      || "").trim();
    const trigger   = (post.matchedTrigger || "missed calls").trim();
    const leadType  = (post.leadType || "").trim();
    const subreddit = (post.subreddit || "").trim();

    if (!username || !url) continue;

    const key  = username.toLowerCase();
    const user = getUser(users, username);

    if (cyclesSeen.has(key)) continue;
    if (user?.step1_sent) { log("SKIP", `already contacted u/${username}`); continue; }
    if (user?.closed) { log("SKIP", `closed u/${username} (${user.closed_reason})`); continue; }

    cyclesSeen.add(key);
    attempted++;

    const tpl = getOpener();

    try {
      await reddit.composeMessage({ to: username, subject: "quick question", text: tpl.text });
      confirmed++;
      log("SENT: step1", `u/${username} | ${tpl.id}`);

      upsertUser(users, username, {
        username, product: "VOICE_AGENT",
        step1_sent: true, step1_sent_at: new Date().toISOString(), step1_template: tpl.id,
        step2_sent: false, step2_sent_at: null, step2_value_template: null, step2_close_template: null,
        replied: false, closed: false, closed_reason: null,
        processed_message_ids: [], trigger, leadType, url, subreddit
      });

      await sentWriter.writeRecords([{
        time: new Date().toISOString(), username, step: "STEP_1", templateId: tpl.id,
        subreddit, leadType, trigger, url, product: "VOICE_AGENT", note: ""
      }]);

      if (attempted < target) {
        const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
        log("INFO", `Waiting ${Math.round(delay/60000)}m before next DM...`);
        await sleep(delay);
      }

    } catch (err) {
      log("ERROR", `Step 1 failed u/${username}: ${err.message}`);
      if (/NOT_WHITELISTED|USER_DOESNT_EXIST|BANNED/.test(err.message)) {
        upsertUser(users, username, { username, step1_sent: false, closed: true, closed_reason: "blocked_or_banned" });
      }
    }
  }

  log("INFO", `Outreach cycle complete -- attempted ${attempted}, confirmed ${confirmed}`);
}

/* =========================
   INBOX MONITOR -- STEP 2
   Sends value pitch + calldone.org link -- auto-close, no manual needed
========================= */
async function checkInboxAndFollowup() {
  const users = loadUsers();
  const botUsername = (process.env.REDDIT_USERNAME || "").toLowerCase();

  try {
    const unread = await reddit.getUnreadMessages({ limit: 50 });
    const toMarkRead = [];

    for (const item of unread) {
      if (item.was_comment !== false) continue;
      if (!item.body || !item.author) continue;

      toMarkRead.push(item);

      const sender    = item.author.name.toLowerCase();
      const messageId = item.name || item.id || "";

      if (sender === botUsername) continue;

      const user = getUser(users, item.author.name);
      if (!user?.step1_sent) { log("SKIP", `unknown sender u/${item.author.name}`); continue; }
      if (user.closed) { log("SKIP", `closed user u/${item.author.name}`); continue; }

      const processed = user.processed_message_ids || [];
      if (messageId && processed.includes(messageId)) { log("SKIP", `already processed ${messageId}`); continue; }

      processed.push(messageId);
      upsertUser(users, item.author.name, { processed_message_ids: processed, replied: true });

      if (isNegativeReply(item.body)) {
        upsertUser(users, item.author.name, { closed: true, closed_reason: "negative_reply" });
        log("SKIP: negative reply", `u/${item.author.name}`);
        continue;
      }

      if (user.step2_sent) {
        log("VOICE FOLLOWUP", `u/${item.author.name} replied after calldone link -- check manually`);
        continue;
      }

      log("INFO", `Reply from u/${item.author.name} -- sending Step 2`);

      const valTpl   = getValueMsg();
      const closeTpl = getCloseMsg();

      try {
        await reddit.composeMessage({ to: item.author.name, subject: "re: quick question", text: valTpl.text });
        log("SENT: step2a", `u/${item.author.name} | ${valTpl.id}`);

        await sentWriter.writeRecords([{
          time: new Date().toISOString(), username: item.author.name,
          step: "STEP_2A", templateId: valTpl.id,
          subreddit: user.subreddit || "", leadType: user.leadType || "",
          trigger: user.trigger || "", url: user.url || "", product: "VOICE_AGENT", note: ""
        }]);

        const pause = FOLLOWUP_MIN_MS + Math.random() * (FOLLOWUP_MAX_MS - FOLLOWUP_MIN_MS);
        log("INFO", `Pausing ${Math.round(pause/1000)}s before close...`);
        await sleep(pause);

        const closeText = closeTpl.text();
        await reddit.composeMessage({ to: item.author.name, subject: "re: quick question", text: closeText });
        log("SENT: step2b", `u/${item.author.name} | ${closeTpl.id}`);

        await sentWriter.writeRecords([{
          time: new Date().toISOString(), username: item.author.name,
          step: "STEP_2B", templateId: closeTpl.id,
          subreddit: user.subreddit || "", leadType: user.leadType || "",
          trigger: user.trigger || "", url: user.url || "", product: "VOICE_AGENT",
          note: "calldone.org link sent -- self-serve close"
        }]);

        upsertUser(users, item.author.name, {
          step2_sent: true, step2_sent_at: new Date().toISOString(),
          step2_value_template: valTpl.id, step2_close_template: closeTpl.id
        });

        log("INFO", `Step 2 complete for u/${item.author.name} -- calldone.org link sent, waiting for self-serve purchase`);

      } catch (err) {
        log("ERROR", `Step 2 failed u/${item.author.name}: ${err.message}`);
      }
    }

    if (toMarkRead.length > 0) {
      try {
        await reddit.markMessagesAsRead(toMarkRead);
        log("INFO", `Marked ${toMarkRead.length} message(s) as read`);
      } catch (err) {
        log("WARN", `markMessagesAsRead failed: ${err.message}`);
      }
    }

  } catch (err) {
    log("ERROR", `Inbox check failed: ${err.message}`);
  }
}

/* =========================
   MAIN
========================= */
(async () => {
  console.log("=".repeat(60));
  console.log("ClientMagnet -- CallDone AI Receptionist for Any Business");
  console.log("$500/mo (self-serve close via calldone.org)");
  console.log("=".repeat(60));

  setInterval(checkInboxAndFollowup, INBOX_POLL_MS);

  while (true) {
    console.log(`\n[${new Date().toLocaleString()}] Starting outreach cycle...`);
    await runOutreachCycle();
    const cycleDelay = (8 + Math.floor(Math.random() * 4)) * 60 * 1000;
    log("INFO", `Next cycle in ${Math.round(cycleDelay/60000)} minutes...`);
    await sleep(cycleDelay);
  }
})();
