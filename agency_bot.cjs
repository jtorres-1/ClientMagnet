// agency_bot.cjs -- ClientMagnet Dual Outreach
// Product 1: Reddit Bot Service ($1,500 setup + $500/mo) -- manual close
// Product 2: AI Voice Agent / CallDone ($1,000 setup + $500/mo) -- auto close via link
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
   PRODUCT 1: BOT SERVICE TEMPLATES
========================= */
const BOT_OPENERS = {
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

const BOT_VALUE = [
  { id: "BV1", text: `yeah that's the core problem -- most businesses are either waiting on inbound or doing manual outreach that doesn't scale\n\ni built an automated outreach system that finds your ideal customers on Reddit and reaches out to them directly. gets replies within days` },
  { id: "BV2", text: `right -- relying on referrals and hoping people find you is unpredictable\n\ni built a system that actively finds people on Reddit who are already looking for what you offer and reaches out automatically. takes the guesswork out` },
  { id: "BV3", text: `makes sense -- manual outreach is time consuming and most automated tools feel spammy\n\ni built something different -- finds high-intent people on Reddit already talking about the problem you solve and reaches out with a personalized message. been getting solid reply rates` }
];

const BOT_CLOSE = [
  { id: "BC1", text: () => `want me to show you how it would work for your specific business? just need to know what you sell and who your ideal customer is` },
  { id: "BC2", text: () => `if you want i can run a quick analysis of which subreddits your ideal customers are actually active in -- no commitment, just so you can see if it makes sense` },
  { id: "BC3", text: () => `would it be worth a quick conversation to see if this would work for what you're selling? takes 10 minutes` }
];

/* =========================
   PRODUCT 2: VOICE AGENT (CALLDONE) TEMPLATES
========================= */
const VOICE_OPENERS = [
  { id: "V_O1", text: `saw your post about the phone situation -- quick question: how are you currently handling calls during your busy periods?` },
  { id: "V_O2", text: `noticed your post about missed calls -- honest question: roughly how many calls do you think you're missing per day?` },
  { id: "V_O3", text: `saw your post about the phone chaos -- are you using any system to handle calls when staff is too busy to answer?` },
  { id: "V_O4", text: `noticed your post -- quick question: do you have anything handling calls after hours or when you're slammed?` }
];

const VOICE_VALUE = [
  { id: "V_V1", text: `right -- every missed call is a reservation you didn't book or an order you didn't take\n\ni built an AI receptionist that answers every call 24/7 -- books reservations, answers questions about hours and menu, handles the repetitive stuff so your staff doesn't have to` },
  { id: "V_V2", text: `yeah that's the thing -- phones during rush hour are impossible to manage and after-hours calls just go nowhere\n\ni built an AI that answers every call automatically. sounds like a real person, books reservations, handles FAQs. your staff never has to pick up again unless they want to` },
  { id: "V_V3", text: `makes sense -- you can't hire someone just to answer phones and your staff has enough to do\n\ni built an AI phone receptionist specifically for restaurants. answers 24/7, books reservations, handles the standard questions. live in 48 hours` }
];

const VOICE_CLOSE = [
  { id: "V_C1", text: () => `you can actually call the AI right now and hear it for yourself -- calldone.org has a live demo number. no commitment, just call it and see if it sounds right for your place` },
  { id: "V_C2", text: () => `i set up a live demo you can call right now -- calldone.org. hear exactly what your customers would hear. takes 2 minutes` },
  { id: "V_C3", text: () => `built a demo you can call right now to hear how it sounds -- calldone.org. if it sounds good, setup takes 48 hours and your phones are handled` }
];

/* =========================
   HELPERS
========================= */
function getBotOpenerCategory(trigger) {
  const t = (trigger || "").toLowerCase();
  if (/no leads|not getting leads|need more leads/.test(t)) return "no_leads";
  if (/no clients|not getting clients|need more clients|can't get clients/.test(t)) return "no_clients";
  if (/slow|dead pipeline|no sales|revenue dropped/.test(t)) return "slow_sales";
  return "general";
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function getOpener(product, trigger) {
  if (product === "VOICE_AGENT") return pick(VOICE_OPENERS);
  return pick(BOT_OPENERS[getBotOpenerCategory(trigger)]);
}

function getValueMsg(product) {
  return product === "VOICE_AGENT" ? pick(VOICE_VALUE) : pick(BOT_VALUE);
}

function getCloseMsg(product) {
  return product === "VOICE_AGENT" ? pick(VOICE_CLOSE) : pick(BOT_CLOSE);
}

/* =========================
   LEAD SCORING
========================= */
function scoreLead(p) {
  let score = 0;
  const t = (p.matchedTrigger || "").toLowerCase();
  if (p.leadType === "CONFIRMED_OWNER_PAIN" || p.leadType === "CONFIRMED_RESTAURANT_OWNER") score += 5;
  if (p.leadType === "GENERAL_BUSINESS_PAIN" || p.leadType === "GENERAL_RESTAURANT_PAIN") score += 3;
  if (/no leads|no clients|missed calls|losing reservations/.test(t)) score += 4;
  if (/desperate|running out|about to shut down|drowning/.test(t)) score += 5;
  if (/tried everything|nothing is working/.test(t)) score += 4;
  if (["entrepreneur","smallbusiness","SaaS","agency","restaurant","restaurantowners"].includes(p.subreddit)) score += 2;
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
    const trigger   = (post.matchedTrigger || "getting clients").trim();
    const leadType  = (post.leadType || "").trim();
    const subreddit = (post.subreddit || "").trim();
    const product   = (post.product || "BOT_SERVICE").trim();

    if (!username || !url) continue;

    const key  = username.toLowerCase();
    const user = getUser(users, username);

    if (cyclesSeen.has(key)) continue;
    if (user?.step1_sent) { log("SKIP", `already contacted u/${username}`); continue; }
    if (user?.closed) { log("SKIP", `closed u/${username} (${user.closed_reason})`); continue; }

    cyclesSeen.add(key);
    attempted++;

    const tpl = getOpener(product, trigger);

    try {
      await reddit.composeMessage({ to: username, subject: "quick question", text: tpl.text });
      confirmed++;
      log("SENT: step1", `u/${username} | ${tpl.id} | ${product}`);

      upsertUser(users, username, {
        username, product,
        step1_sent: true, step1_sent_at: new Date().toISOString(), step1_template: tpl.id,
        step2_sent: false, step2_sent_at: null, step2_value_template: null, step2_close_template: null,
        replied: false, closed: false, closed_reason: null,
        ready_for_manual: product === "BOT_SERVICE" ? false : null,
        processed_message_ids: [], trigger, leadType, url, subreddit
      });

      await sentWriter.writeRecords([{
        time: new Date().toISOString(), username, step: "STEP_1", templateId: tpl.id,
        subreddit, leadType, trigger, url, product, note: ""
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
   BOT_SERVICE: Step 2 then manual takeover flag
   VOICE_AGENT: Step 2 then auto link to calldone.org -- no manual needed
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
        if (user.product === "BOT_SERVICE") {
          upsertUser(users, item.author.name, { ready_for_manual: true });
          log("MANUAL NEEDED", `u/${item.author.name} replied after Step 2 -- take over now`);
        } else {
          log("VOICE FOLLOWUP", `u/${item.author.name} replied after calldone link -- check manually`);
        }
        continue;
      }

      const product = user.product || "BOT_SERVICE";
      log("INFO", `Reply from u/${item.author.name} [${product}] -- sending Step 2`);

      const valTpl   = getValueMsg(product);
      const closeTpl = getCloseMsg(product);

      try {
        await reddit.composeMessage({ to: item.author.name, subject: "re: quick question", text: valTpl.text });
        log("SENT: step2a", `u/${item.author.name} | ${valTpl.id} | ${product}`);

        await sentWriter.writeRecords([{
          time: new Date().toISOString(), username: item.author.name,
          step: "STEP_2A", templateId: valTpl.id,
          subreddit: user.subreddit || "", leadType: user.leadType || "",
          trigger: user.trigger || "", url: user.url || "", product, note: ""
        }]);

        const pause = FOLLOWUP_MIN_MS + Math.random() * (FOLLOWUP_MAX_MS - FOLLOWUP_MIN_MS);
        log("INFO", `Pausing ${Math.round(pause/1000)}s before close...`);
        await sleep(pause);

        const closeText = closeTpl.text();
        await reddit.composeMessage({ to: item.author.name, subject: "re: quick question", text: closeText });
        log("SENT: step2b", `u/${item.author.name} | ${closeTpl.id} | ${product}`);

        const note = product === "VOICE_AGENT"
          ? "calldone.org link sent -- self-serve close"
          : "soft close sent -- monitor for reply to take over manually";

        await sentWriter.writeRecords([{
          time: new Date().toISOString(), username: item.author.name,
          step: "STEP_2B", templateId: closeTpl.id,
          subreddit: user.subreddit || "", leadType: user.leadType || "",
          trigger: user.trigger || "", url: user.url || "", product, note
        }]);

        upsertUser(users, item.author.name, {
          step2_sent: true, step2_sent_at: new Date().toISOString(),
          step2_value_template: valTpl.id, step2_close_template: closeTpl.id,
          ready_for_manual: product === "BOT_SERVICE" ? false : null
        });

        if (product === "BOT_SERVICE") {
          log("INFO", `Step 2 complete for u/${item.author.name} -- watch for reply to close manually at $1,500`);
        } else {
          log("INFO", `Step 2 complete for u/${item.author.name} -- calldone.org link sent, waiting for self-serve purchase`);
        }

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
  console.log("ClientMagnet -- Dual Product Outreach");
  console.log("Product 1: Reddit Bot Service -- $1,500 + $500/mo (manual close)");
  console.log("Product 2: CallDone Voice Agent -- $1,000 + $500/mo (auto close)");
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
