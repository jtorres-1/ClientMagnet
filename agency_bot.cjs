// agency_bot.cjs -- ClientMagnet Outreach (Business Owner Lead Gen)
// 2-Step Automated + Manual Step 3 Takeover
require("dotenv").config();
const snoowrap = require("snoowrap");
const fs       = require("fs");
const path     = require("path");
const csv      = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");

/* =========================
   REDDIT CLIENT
========================= */
const reddit = new snoowrap({
  userAgent:    process.env.REDDIT_USER_AGENT,
  clientId:     process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username:     process.env.REDDIT_USERNAME,
  password:     process.env.REDDIT_PASSWORD,
});

/* =========================
   PATHS
========================= */
const baseDir = path.resolve(__dirname, "logs");
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

const leadsPath = path.join(baseDir, "clean_leads.csv");
const sentPath  = path.join(baseDir, "clean_leads_dmed.csv");
const usersPath = path.join(baseDir, "contacted_users.json");

/* =========================
   RATE LIMITS
========================= */
const MIN_DMS_PER_CYCLE = 15;
const MAX_DMS_PER_CYCLE = 25;
const MIN_DELAY_MS      = 3 * 60 * 1000;
const MAX_DELAY_MS      = 5 * 60 * 1000;
const INBOX_POLL_MS     = 60 * 1000;
const FOLLOWUP_MIN_MS   = 10 * 1000;
const FOLLOWUP_MAX_MS   = 30 * 1000;

/* =========================
   NEGATIVE REPLY FILTER
========================= */
const NEGATIVE_SIGNALS = [
  "not interested",
  "stop",
  "leave me alone",
  "no thanks",
  "no thank you",
  "unsubscribe",
  "remove me",
  "don't message",
  "do not message",
  "spam",
  "reported",
  "block"
];

function isNegativeReply(body) {
  const b = (body || "").toLowerCase();
  return NEGATIVE_SIGNALS.some(s => b.includes(s));
}

/* =========================
   USER STATE
========================= */
function loadUsers() {
  if (!fs.existsSync(usersPath)) return {};
  try { return JSON.parse(fs.readFileSync(usersPath, "utf8")); }
  catch { return {}; }
}

function saveUsers(users) {
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
}

function getUser(users, username) {
  return users[username.toLowerCase()] || null;
}

function upsertUser(users, username, fields) {
  const key = username.toLowerCase();
  users[key] = { ...(users[key] || {}), ...fields, last_message_at: new Date().toISOString() };
  saveUsers(users);
  return users[key];
}

/* =========================
   CSV WRITER
========================= */
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
    { id: "note",       title: "Note" },
  ],
  append: true
});

function log(tag, msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${tag}: ${msg}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* =========================
   STEP 1 OPENERS -- QUALIFYING QUESTIONS
   No pitch. No price. Just a question that gets them talking.
========================= */
const OPENERS = {
  no_leads: [
    { id: "O_NL1", text: `saw your post about the lead gen struggle -- that's a frustrating spot to be in\n\nquick question: are you doing any outreach right now or mostly waiting on inbound?` },
    { id: "O_NL2", text: `noticed your post about not getting leads -- been there\n\nhonest question: have you tried any kind of direct outreach or is it mostly organic/ads right now?` },
    { id: "O_NL3", text: `saw your post about the lead situation -- rough\n\nare you actively reaching out to potential clients or mostly relying on people finding you?` }
  ],
  no_clients: [
    { id: "O_NC1", text: `saw your post about struggling to get clients -- that grind is real\n\nquick question: what's your current main channel for finding new business?` },
    { id: "O_NC2", text: `noticed your post about the client acquisition problem -- are you doing any direct outreach or mostly relying on referrals and inbound?` },
    { id: "O_NC3", text: `saw your post about getting clients -- honest question: have you tried any automated outreach or is it all manual right now?` }
  ],
  slow_sales: [
    { id: "O_SS1", text: `saw your post about the slow month -- happens to everyone but still stings\n\nare you actively prospecting right now or waiting for things to pick up?` },
    { id: "O_SS2", text: `noticed your post about slow sales -- quick question: is your pipeline completely dry or just not converting?` },
    { id: "O_SS3", text: `saw your post about the sales situation -- are you reaching out to new prospects or mostly working existing leads?` }
  ],
  general: [
    { id: "O_G1", text: `saw your post about the growth struggle -- quick question: what's your main bottleneck right now, finding leads or closing them?` },
    { id: "O_G2", text: `noticed your post -- are you getting enough leads but not closing, or is the problem finding people in the first place?` },
    { id: "O_G3", text: `saw your post -- honest question: have you tried any kind of automated outreach for your business yet?` }
  ]
};

/* =========================
   STEP 2 VALUE REPLY -- POSITION AS SOLUTION
   No price. No hard sell. Just value and curiosity.
========================= */
const FOLLOWUP_VALUE = [
  { id: "FV1", text: `yeah that's the core problem -- most businesses are either waiting on inbound or doing manual outreach that doesn't scale\n\ni built an automated outreach system that finds your ideal customers on Reddit and reaches out to them directly. gets replies within days` },
  { id: "FV2", text: `right -- relying on referrals and hoping people find you is unpredictable\n\ni built a system that actively finds people on Reddit who are already looking for what you offer and reaches out automatically. takes the guesswork out` },
  { id: "FV3", text: `makes sense -- manual outreach is time consuming and most automated tools feel spammy\n\ni built something different -- it finds high-intent people on Reddit already talking about the problem you solve and reaches out with a personalized message. been getting solid reply rates` },
  { id: "FV4", text: `yeah that's the issue -- most outreach is either too broad or too manual\n\ni run done-for-you Reddit outreach campaigns. find the exact people already talking about needing your solution and reach out automatically. happy to show you how it works` }
];

/* =========================
   STEP 2B -- SOFT CLOSE (NO PRICE YET)
   Goal: get them to say yes to a conversation
========================= */
const FOLLOWUP_CLOSE = [
  { id: "FC1", text: (u) => `want me to show you how it would work for your specific business? just need to know what you sell and who your ideal customer is` },
  { id: "FC2", text: (u) => `if you want i can run a quick analysis of which subreddits your ideal customers are actually active in -- no commitment, just so you can see if it makes sense` },
  { id: "FC3", text: (u) => `would it be worth a quick conversation to see if this would work for what you're selling? takes 10 minutes` }
];

/* =========================
   HELPERS
========================= */
function getOpenerCategory(trigger) {
  const t = (trigger || "").toLowerCase();
  if (/no leads|not getting leads|need more leads/.test(t)) return "no_leads";
  if (/no clients|not getting clients|need more clients|can't get clients/.test(t)) return "no_clients";
  if (/slow|dead pipeline|no sales|revenue dropped/.test(t)) return "slow_sales";
  return "general";
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function getOpener(trigger)  { return pick(OPENERS[getOpenerCategory(trigger)]); }
function getValueMsg()       { return pick(FOLLOWUP_VALUE); }
function getCloseMsg()       { return pick(FOLLOWUP_CLOSE); }

/* =========================
   LEAD SCORING
========================= */
function scoreLead(p) {
  let score = 0;
  const t = (p.matchedTrigger || "").toLowerCase();
  if (p.leadType === "CONFIRMED_OWNER_PAIN") score += 5;
  if (p.leadType === "GENERAL_BUSINESS_PAIN") score += 3;
  if (/no leads|no clients/.test(t))  score += 4;
  if (/slow sales|dead pipeline/.test(t)) score += 3;
  if (/desperate|running out|about to shut down/.test(t)) score += 5;
  if (/tried everything|nothing is working/.test(t)) score += 4;
  if (["entrepreneur","smallbusiness","SaaS","agency"].includes(p.subreddit)) score += 2;
  return score;
}

/* =========================
   LOAD LEADS
========================= */
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
  if (!leads.length) {
    log("INFO", "No leads found. Waiting for scraper...");
    return;
  }

  leads.sort((a, b) => scoreLead(b) - scoreLead(a));

  const users      = loadUsers();
  const target     = MIN_DMS_PER_CYCLE + Math.floor(Math.random() * (MAX_DMS_PER_CYCLE - MIN_DMS_PER_CYCLE + 1));
  const cyclesSeen = new Set();

  let attempted = 0;
  let confirmed = 0;

  for (const post of leads) {
    if (attempted >= target) {
      log("INFO", `Cycle target reached (${target} DMs).`);
      break;
    }

    const username  = (post.username || "").trim();
    const url       = (post.url      || "").trim();
    const trigger   = (post.matchedTrigger || "getting clients").trim();
    const leadType  = (post.leadType || "").trim();
    const subreddit = (post.subreddit || "").trim();

    if (!username || !url) continue;

    const key  = username.toLowerCase();
    const user = getUser(users, username);

    if (cyclesSeen.has(key)) continue;

    if (user) {
      if (user.step1_sent) {
        log("SKIP", `already contacted u/${username}`);
        continue;
      }
      if (user.closed) {
        log("SKIP", `closed u/${username} (${user.closed_reason})`);
        continue;
      }
    }

    cyclesSeen.add(key);
    attempted++;

    const tpl = getOpener(trigger);

    try {
      await reddit.composeMessage({
        to:      username,
        subject: "quick question",
        text:    tpl.text
      });

      confirmed++;
      log("SENT: step1", `u/${username} | ${tpl.id} | ${getOpenerCategory(trigger)}`);

      upsertUser(users, username, {
        username,
        step1_sent:           true,
        step1_sent_at:        new Date().toISOString(),
        step1_template:       tpl.id,
        step2_sent:           false,
        step2_sent_at:        null,
        step2_value_template: null,
        step2_close_template: null,
        replied:              false,
        closed:               false,
        closed_reason:        null,
        ready_for_manual:     false,
        processed_message_ids: [],
        trigger,
        leadType,
        url,
        subreddit
      });

      await sentWriter.writeRecords([{
        time: new Date().toISOString(), username,
        step: "STEP_1", templateId: tpl.id,
        subreddit, leadType, trigger, url, note: ""
      }]);

      if (attempted < target) {
        const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
        log("INFO", `Waiting ${Math.round(delay/60000)}m before next DM...`);
        await sleep(delay);
      }

    } catch (err) {
      log("ERROR", `Step 1 failed u/${username}: ${err.message}`);
      if (/NOT_WHITELISTED|USER_DOESNT_EXIST|BANNED/.test(err.message)) {
        upsertUser(users, username, {
          username, step1_sent: false,
          closed: true, closed_reason: "blocked_or_banned"
        });
      }
    }
  }

  log("INFO", `Outreach cycle complete -- attempted ${attempted}, confirmed ${confirmed}`);
}

/* =========================
   INBOX MONITOR -- STEP 2
   After Step 2 sends, flags user as ready_for_manual = true
   so you know to take over manually
========================= */
async function checkInboxAndFollowup() {
  const users = loadUsers();
  const botUsername = (process.env.REDDIT_USERNAME || "").toLowerCase();

  try {
    const unread     = await reddit.getUnreadMessages({ limit: 50 });
    const toMarkRead = [];

    for (const item of unread) {
      if (item.was_comment !== false) continue;
      if (!item.body)                 continue;
      if (!item.author)               continue;

      toMarkRead.push(item);

      const sender    = item.author.name.toLowerCase();
      const messageId = item.name || item.id || "";

      if (sender === botUsername) continue;

      const user = getUser(users, item.author.name);

      if (!user || !user.step1_sent) {
        log("SKIP", `unknown sender u/${item.author.name}`);
        continue;
      }

      if (user.closed) {
        log("SKIP", `closed user u/${item.author.name}`);
        continue;
      }

      const processed = user.processed_message_ids || [];
      if (messageId && processed.includes(messageId)) {
        log("SKIP", `already processed message ${messageId}`);
        continue;
      }

      processed.push(messageId);
      upsertUser(users, item.author.name, { processed_message_ids: processed, replied: true });

      if (isNegativeReply(item.body)) {
        upsertUser(users, item.author.name, {
          closed: true,
          closed_reason: "negative_reply"
        });
        log("SKIP: negative reply", `u/${item.author.name} -- closing`);
        continue;
      }

      if (user.step2_sent) {
        // Step 2 already sent -- flag for manual takeover
        upsertUser(users, item.author.name, { ready_for_manual: true });
        log("MANUAL NEEDED", `u/${item.author.name} replied after Step 2 -- take over now`);
        continue;
      }

      log("INFO", `Reply from u/${item.author.name} -- sending Step 2`);

      const valTpl   = getValueMsg();
      const closeTpl = getCloseMsg();

      try {
        // Step 2a -- value
        await reddit.composeMessage({
          to:      item.author.name,
          subject: "re: quick question",
          text:    valTpl.text
        });
        log("SENT: step2a", `u/${item.author.name} | ${valTpl.id}`);

        await sentWriter.writeRecords([{
          time: new Date().toISOString(), username: item.author.name,
          step: "STEP_2A", templateId: valTpl.id,
          subreddit: user.subreddit || "", leadType: user.leadType || "",
          trigger: user.trigger || "", url: user.url || "", note: ""
        }]);

        const pause = FOLLOWUP_MIN_MS + Math.random() * (FOLLOWUP_MAX_MS - FOLLOWUP_MIN_MS);
        log("INFO", `Pausing ${Math.round(pause/1000)}s before close...`);
        await sleep(pause);

        // Step 2b -- soft close
        const closeText = closeTpl.text(item.author.name);
        await reddit.composeMessage({
          to:      item.author.name,
          subject: "re: quick question",
          text:    closeText
        });
        log("SENT: step2b", `u/${item.author.name} | ${closeTpl.id}`);

        await sentWriter.writeRecords([{
          time: new Date().toISOString(), username: item.author.name,
          step: "STEP_2B", templateId: closeTpl.id,
          subreddit: user.subreddit || "", leadType: user.leadType || "",
          trigger: user.trigger || "", url: user.url || "", note: "soft close sent -- monitor for reply"
        }]);

        upsertUser(users, item.author.name, {
          step2_sent:           true,
          step2_sent_at:        new Date().toISOString(),
          step2_value_template: valTpl.id,
          step2_close_template: closeTpl.id,
          ready_for_manual:     false
        });

        log("INFO", `Step 2 complete for u/${item.author.name} -- watch for reply to take over manually`);

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
  console.log("ClientMagnet -- Business Owner Lead Gen Outreach");
  console.log("Target: $1,500 setup + $500/month retainer");
  console.log("=".repeat(60));
  console.log(`Step 1 DMs per cycle:  ${MIN_DMS_PER_CYCLE}-${MAX_DMS_PER_CYCLE}`);
  console.log(`Delay between DMs:     ${MIN_DELAY_MS/60000}-${MAX_DELAY_MS/60000} min`);
  console.log(`Inbox poll interval:   ${INBOX_POLL_MS/1000}s`);
  console.log(`State file:            logs/contacted_users.json`);
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
