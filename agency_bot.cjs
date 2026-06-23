// agency_bot.cjs — DevHire + lockedIn Outreach
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
const MIN_DELAY_MS      = 2 * 60 * 1000;
const MAX_DELAY_MS      = 4 * 60 * 1000;
const INBOX_POLL_MS     = 60 * 1000;

// ─── USER STATE ──────────────────────────────────────────────────────────────
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

// ─── DEVHIRE BOT MESSAGES ────────────────────────────────────────────────────
const DEVHIRE_BOT_MESSAGES = [
  {
    id: "DH_BOT_1",
    text: `saw your post. i build custom bots and automation tools for businesses across the US\n\nrecent work includes a reddit dm automation SaaS with active paying users ([autosub.online](https://autosub.online)), a google maps lead scraper SaaS ([mapzap.org](https://mapzap.org)), and a custom booking bot for a logistics company in saudi arabia\n\nif something broke or you need something built from scratch, i can have it running in 48 hours. flat fee, no hourly\n\ndm me what you need`
  },
  {
    id: "DH_BOT_2",
    text: `saw your post. this sounds like something i can fix fast\n\ni build and fix bots, scrapers, and automation tools. recent builds include a reddit outreach bot in production ([autosub.online](https://autosub.online)), a google maps scraper with email lookup ([mapzap.org](https://mapzap.org)), and a multi-account booking bot for a client in saudi arabia\n\n48 hour turnaround, flat fee. dm me the details`
  },
  {
    id: "DH_BOT_3",
    text: `saw your post. i specialize in building and fixing automation bots and scrapers\n\nlive projects: [autosub.online](https://autosub.online) (reddit dm automation SaaS), [mapzap.org](https://mapzap.org) (google maps lead scraper), and a custom booking automation for a logistics company\n\nflat fee, delivered in 48 hours. what do you need built or fixed`
  }
];

// ─── DEVHIRE GENERAL MESSAGES ─────────────────────────────────────────────────
const DEVHIRE_GENERAL_MESSAGES = [
  {
    id: "DH_GEN_1",
    text: `saw your post. i build web apps, scrapers, bots, and ai integrations for businesses across the US\n\nrecent work: [autosub.online](https://autosub.online) (reddit outreach SaaS), [mapzap.org](https://mapzap.org) (google maps lead scraper SaaS), and a custom booking bot for a logistics company\n\n48 hour turnaround, flat fee, no hourly. dm me what you need`
  },
  {
    id: "DH_GEN_2",
    text: `saw your post. available now for freelance dev work\n\ni build websites, web apps, scrapers, bots, and ai integrations. recent live projects: [autosub.online](https://autosub.online) and [mapzap.org](https://mapzap.org)\n\nflat fee, 48 hour delivery, based in the US. dm me a scope`
  },
  {
    id: "DH_GEN_3",
    text: `saw your post. i ship fast and charge flat fees\n\nrecent builds: [autosub.online](https://autosub.online) (reddit automation SaaS), [mapzap.org](https://mapzap.org) (google maps scraper with stripe payments), custom booking bot for a logistics client\n\nwebsites, scrapers, bots, ai integrations. 48 hours, flat fee. what do you need`
  }
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
  let score = 0;
  const t = (p.matchedTrigger || "").toLowerCase();
  const sub = (p.subreddit || "").toLowerCase();
  const product = (p.product || "LOCKEDIN").toUpperCase();
  const leadType = (p.leadType || "").toUpperCase();

  if (product === "LOCKEDIN") score += 25;
  if (product === "DEVHIRE") score += 15;

  if (leadType === "LOCKEDIN_INTENT") score += 20;
  if (leadType === "DEV_HIRE_BOT") score += 20;
  if (leadType === "DEV_HIRE_GENERAL") score += 12;

  if (/waste|wasting|overwhelmed|procrastinat|chaotic|unproductive|no structure/.test(t)) score += 10;
  if (/broken bot|bot stopped|automation broke|fix my bot|scraper stopped/.test(t)) score += 12;
  if (/budget|willing to pay|will pay|paid/.test(t)) score += 6;

  if (["productivity","getdisciplined","selfimprovement","ADHD","timemanagement","entrepreneur","Entrepreneur"].includes(sub)) score += 10;
  if (["plumbing","HVAC","electricians","Roofing","Contractors","smallbusiness"].includes(sub)) score += 8;
  if (["forhire","slavelabour"].includes(sub)) score += 5;

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
        log("REPLY_NEG", `u/${item.author.name} not interested — closing lead`);
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
      const chunkSize = 25;
      for (let i = 0; i < toMarkRead.length; i += chunkSize) {
        const chunk = toMarkRead.slice(i, i + chunkSize);
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
  if (!leads.length) { log("INFO", "No leads found. Waiting for scraper..."); return; }

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
    if (user?.closed) { log("SKIP", `closed u/${username} (${user.closed_reason})`); continue; }

    cyclesSeen.add(key);
    attempted++;

    let tpl, subject;
    if (product === "LOCKEDIN") {
      tpl = pick(LOCKEDIN_MESSAGES);
      subject = "this might help";
 else if (product === "DEVHIRE") {
      if (leadType === "DEV_HIRE_BOT") {
        tpl = pick(DEVHIRE_BOT_MESSAGES);
        subject = "bot and automation dev for hire";
      } else {
        tpl = pick(DEVHIRE_GENERAL_MESSAGES);
        subject = "dev for hire";
      }
    } else {
      tpl = pick(LOCKEDIN_MESSAGES);
      subject = "this might help";
    }

    try {
      const freshUser = getUser(loadUsers(), username);
      if (freshUser?.sent) {
        log("SKIP", `already contacted u/${username} (fresh check)`);
        continue;
      }

      await reddit.composeMessage({ to: username, subject, text: tpl.text });
      confirmed++;
      log("SENT", `u/${username} | ${tpl.id} | [${product}/${leadType}] | score:${scoreLead(post)}`);

      upsertUser(users, username, {
        username, product, leadType,
        sent: true, sent_at: new Date().toISOString(), template: tpl.id,
        replied: false, reply_type: null, reply_body: null,
        closed: false, closed_reason: null,
        trigger, url, subreddit
      });

      await sentWriter.writeRecords([{
        time: new Date().toISOString(), username, templateId: tpl.id,
        subreddit, leadType, trigger, url, product
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

  log("INFO", `Outreach cycle complete attempted ${attempted}, confirmed ${confirmed}`);
}

// ─── MAIN LOOP ───────────────────────────────────────────────────────────────
(async () => {
  console.log("=".repeat(60));
  console.log("ClientMagnet — DevHire + lockedIn Outreach Bot");
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
