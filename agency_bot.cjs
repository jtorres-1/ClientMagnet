// agency_bot.cjs -- ClientMagnet MapZap Outreach
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
const MIN_DELAY_MS      = 2 * 60 * 1000;
const MAX_DELAY_MS      = 4 * 60 * 1000;
const INBOX_POLL_MS     = 60 * 1000;

const NEGATIVE_SIGNALS = [
  "not interested","stop","leave me alone","no thanks","no thank you",
  "unsubscribe","remove me","don't message","do not message","spam","reported","block",
  "go away","f off","scam","reported you"
];

const POSITIVE_SIGNALS = [
  "how much","price","cost","how does it work","tell me more","interested",
  "sounds good","where","link","send it","sign me up","i'll try","let me see",
  "how many","what is it","can i","do you","does it","will it","more info"
];

function isNegativeReply(body) {
  const b = (body || "").toLowerCase();
  return NEGATIVE_SIGNALS.some(s => b.includes(s));
}

function isPositiveReply(body) {
  const b = (body || "").toLowerCase();
  return POSITIVE_SIGNALS.some(s => b.includes(s));
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
    { id: "time",       title: "Time" },
    { id: "username",   title: "Username" },
    { id: "step",       title: "Step" },
    { id: "templateId", title: "Template ID" },
    { id: "subreddit",  title: "Subreddit" },
    { id: "leadType",   title: "Lead Type" },
    { id: "trigger",    title: "Matched Trigger" },
    { id: "url",        title: "Post URL" },
    { id: "product",    title: "Product" },
    { id: "note",       title: "Note" },
  ],
  append: true
});

function log(tag, msg) { console.log(`[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* =========================
   OUTREACH MESSAGES — no subject, casual, one shot
========================= */
const OUTREACH_MESSAGES = [
  {
    id: "MZ_1",
    text: `not sure if this helps but i built a tool that pulls 100 local business leads as a CSV in about 60 seconds\n\nyou type a business type and city, it returns names, phone numbers, and addresses. $49 one time\n\nhttps://mapzap.org`
  },
  {
    id: "MZ_2",
    text: `saw your post -- might be relevant\n\ni built mapzap, pulls 100 local business leads (name, phone, address) as a CSV in under a minute. $49 flat, no subscription\n\nhttps://mapzap.org`
  },
  {
    id: "MZ_3",
    text: `this might save you some time -- built a tool that scrapes 100 local business leads in 60 seconds\n\ntype a niche and city, get a CSV with names, phones, addresses. one time $49\n\nhttps://mapzap.org`
  },
  {
    id: "MZ_4",
    text: `building lead lists manually is a nightmare -- i built something that does it in 60 seconds\n\n100 local businesses, names + phone numbers + addresses, CSV download. $49 once\n\nhttps://mapzap.org`
  },
  {
    id: "MZ_5",
    text: `random but saw your post and thought of this -- i built a lead scraper that pulls 100 local businesses from any city in 60 seconds\n\nCSV with name, phone, address. $49 one time, no monthly fee\n\nhttps://mapzap.org`
  },
  {
    id: "MZ_6",
    text: `if you're doing any kind of local outreach this might be useful\n\nbuilt a tool that pulls 100 business leads (name, phone, address) from any city and niche as a CSV in under a minute. $49 flat\n\nhttps://mapzap.org`
  },
  {
    id: "MZ_7",
    text: `hey -- saw your post about leads and built exactly this\n\ntype a business type and city, get 100 leads with phones and addresses as a CSV in 60 seconds. $49 one time\n\nhttps://mapzap.org`
  }
];

/* =========================
   REPLY CLOSER — fires ONCE only, then hands off to human
========================= */
const REPLY_CLOSERS = [
  {
    id: "RC_1",
    text: `yeah -- $49 one time, go to https://mapzap.org, pay via stripe, type any business type and city, download the CSV instantly\n\n100 leads with name, phone, address, website. no subscription, no limits on searches`
  },
  {
    id: "RC_2",
    text: `$49 once at https://mapzap.org -- type something like "dentists, Los Angeles" and you get 100 leads as a CSV with names, phones, and addresses in about 60 seconds\n\nno monthly fee`
  },
  {
    id: "RC_3",
    text: `one time $49 at https://mapzap.org -- type your niche and city, download the CSV\n\n100 leads with business name, phone, address, website. works for any niche, any US city`
  }
];

/* =========================
   LEAD SCORING
========================= */
function scoreLead(p) {
  let score = 0;
  const t = (p.matchedTrigger || "").toLowerCase();
  const sub = (p.subreddit || "").toLowerCase();

  if (p.leadType === "HIGH_INTENT_OWNER") score += 10;
  else if (p.leadType === "HIGH_INTENT") score += 7;
  else if (p.leadType === "MEDIUM_INTENT_OWNER") score += 5;
  else score += 2;

  if (/need leads|buy leads|lead source|lead list|lead database/.test(t)) score += 5;
  if (/where (do i|can i) (find|get)|how (do i|to) get/.test(t)) score += 4;
  if (/apollo|zoominfo|hunter|lusha|seamless/.test(t)) score += 6;
  if (/local businesses|local outreach|local market/.test(t)) score += 4;
  if (/cold outreach|cold email|prospecting/.test(t)) score += 3;

  if (["sales","b2bsales","coldemail","coldcalling","leadgeneration"].includes(sub)) score += 5;
  if (["realtors","RealEstate","WholesaleRealestate"].includes(sub)) score += 4;
  if (["Insurance","InsuranceAgent","LifeInsurance"].includes(sub)) score += 4;
  if (["agency","marketing","digital_marketing","freelance"].includes(sub)) score += 3;
  if (["solar","roofing","HVAC"].includes(sub)) score += 4;

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
   OUTREACH CYCLE
   NO subject line on DMs -- sounds human
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
    const trigger   = (post.matchedTrigger || "leads").trim();
    const leadType  = (post.leadType || "").trim();
    const subreddit = (post.subreddit || "").trim();
    if (!username || !url) continue;

    const key  = username.toLowerCase();
    const user = getUser(users, username);
    if (cyclesSeen.has(key)) continue;
    if (user?.sent) { log("SKIP", `already contacted u/${username}`); continue; }
    if (user?.closed) { log("SKIP", `closed u/${username} (${user.closed_reason})`); continue; }
    cyclesSeen.add(key);
    attempted++;

    const tpl = pick(OUTREACH_MESSAGES);
    try {
      // NO subject line -- blank subject sounds human
      await reddit.composeMessage({ to: username, subject: "", text: tpl.text });
      confirmed++;
      log("SENT", `u/${username} | ${tpl.id} | score:${scoreLead(post)} | ${leadType}`);
      upsertUser(users, username, {
        username, product: "MAPZAP",
        sent: true, sent_at: new Date().toISOString(), template: tpl.id,
        replied: false, reply_positive: false,
        closer_sent: false, closed: false, closed_reason: null,
        processed_message_ids: [], trigger, leadType, url, subreddit
      });
      await sentWriter.writeRecords([{
        time: new Date().toISOString(), username, step: "OUTREACH", templateId: tpl.id,
        subreddit, leadType, trigger, url, product: "MAPZAP", note: "initial DM"
      }]);
      if (attempted < target) {
        const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
        log("INFO", `Waiting ${Math.round(delay/60000)}m before next DM...`);
        await sleep(delay);
      }
    } catch (err) {
      log("ERROR", `DM failed u/${username}: ${err.message}`);
      if (/NOT_WHITELISTED|USER_DOESNT_EXIST|BANNED/.test(err.message)) {
        upsertUser(users, username, { username, sent: false, closed: true, closed_reason: "blocked_or_banned" });
      }
    }
  }
  log("INFO", `Outreach cycle complete -- attempted ${attempted}, confirmed ${confirmed}`);
}

/* =========================
   INBOX MONITOR
   Closer fires ONCE only.
   After that, logs it and stops -- human takes over.
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
      if (!user?.sent) { log("SKIP", `unknown sender u/${item.author.name}`); continue; }
      if (user.closed) { log("SKIP", `closed u/${item.author.name}`); continue; }

      const processed = user.processed_message_ids || [];
      if (messageId && processed.includes(messageId)) { log("SKIP", `already processed ${messageId}`); continue; }
      processed.push(messageId);
      upsertUser(users, item.author.name, { processed_message_ids: processed, replied: true });

      if (isNegativeReply(item.body)) {
        upsertUser(users, item.author.name, { closed: true, closed_reason: "negative_reply" });
        log("NEGATIVE", `u/${item.author.name} -- closed`);
        continue;
      }

      // CLOSER ALREADY SENT -- stop bot, human takes over
      if (user.closer_sent) {
        log("NEEDS HUMAN", `u/${item.author.name} replied after closer -- CHECK YOUR REDDIT INBOX`);
        continue;
      }

      // Send closer ONE time only
      log("REPLY", `u/${item.author.name} -- sending closer once`);
      const closer = pick(REPLY_CLOSERS);
      try {
        await reddit.composeMessage({
          to: item.author.name,
          subject: "",
          text: closer.text
        });
        log("CLOSER SENT", `u/${item.author.name} | ${closer.id} -- bot done, human takes over if they reply again`);
        await sentWriter.writeRecords([{
          time: new Date().toISOString(), username: item.author.name,
          step: "CLOSER", templateId: closer.id,
          subreddit: user.subreddit || "", leadType: user.leadType || "",
          trigger: user.trigger || "", url: user.url || "",
          product: "MAPZAP", note: "closer sent once -- hand off to human"
        }]);
        upsertUser(users, item.author.name, {
          reply_positive: true,
          closer_sent: true,
          closer_sent_at: new Date().toISOString(),
          closer_template: closer.id
        });
      } catch (err) {
        log("ERROR", `Closer failed u/${item.author.name}: ${err.message}`);
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
  console.log("ClientMagnet -- MapZap Outreach Bot");
  console.log("100 Local Business Leads -- https://mapzap.org -- $49");
  console.log("=".repeat(60));

  setInterval(checkInboxAndFollowup, INBOX_POLL_MS);

  while (true) {
    console.log(`\n[${new Date().toLocaleString()}] Starting outreach cycle...`);
    await runOutreachCycle();
    const cycleDelay = (6 + Math.floor(Math.random() * 3)) * 60 * 1000;
    log("INFO", `Next cycle in ${Math.round(cycleDelay/60000)} minutes...`);
    await sleep(cycleDelay);
  }
})();
