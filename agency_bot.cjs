// agency_bot.cjs -- ClientMagnet MapZap + DevHire Outreach
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
  "how many","what is it","can i","do you","does it","will it","more info",
  "portfolio","rate","available","timeline","when can you start"
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
   MAPZAP OUTREACH MESSAGES
========================= */
const MAPZAP_MESSAGES = [
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
  }
];

/* =========================
   DEV HIRE OUTREACH MESSAGES
========================= */
const DEVHIRE_MESSAGES = [
  {
    id: "DH_1",
    text: `saw your post. i'm a python developer based in LA available for immediate freelance work. i've built a live google maps scraper with stripe payments, a cold email pipeline pushing 500 emails per day, and a reddit automation bot in production. websites, scrapers, bots, ai integrations. 48 hour delivery, flat fee.\n\nportfolio: https://casa-fuego-demo.netlify.app\nlinkedin: https://www.linkedin.com/in/jesse-torres11/\n\ndm me a scope`
  },
  {
    id: "DH_2",
    text: `saw your post and i'm available. python developer in LA, i ship fast. built a google maps lead scraper with stripe, a 500 email per day cold outreach pipeline, and a reddit automation bot all in production.\n\nwebsites, scrapers, automation, ai integrations. flat fee, 48 hour delivery.\n\nportfolio: https://casa-fuego-demo.netlify.app\nlinkedin: https://www.linkedin.com/in/jesse-torres11/\n\nwhat do you need built`
  },
  {
    id: "DH_3",
    text: `your post caught my eye. python dev here, based in LA, available now. i have live production projects including a google maps scraper, a cold email pipeline, and a reddit dm bot.\n\ni do websites, scrapers, automation bots, and ai integrations. 48 hour turnaround, flat fee.\n\nportfolio: https://casa-fuego-demo.netlify.app\nlinkedin: https://www.linkedin.com/in/jesse-torres11/\n\ndm me what you need`
  }
];

/* =========================
   MAPZAP REPLY CLOSER
========================= */
const MAPZAP_CLOSERS = [
  {
    id: "RC_1",
    text: `yeah -- $49 one time, go to https://mapzap.org, pay via stripe, type any business type and city, download the CSV instantly\n\n100 leads with name, phone, address, website. no subscription, no limits on searches`
  },
  {
    id: "RC_2",
    text: `$49 once at https://mapzap.org -- type something like "dentists, Los Angeles" and you get 100 leads as a CSV with names, phones, and addresses in about 60 seconds\n\nno monthly fee`
  }
];

/* =========================
   LEAD SCORING
========================= */
function scoreLead(p) {
  let score = 0;
  const t = (p.matchedTrigger || "").toLowerCase();
  const sub = (p.subreddit || "").toLowerCase();
  const product = (p.product || "").toUpperCase();

  if (product === "DEVHIRE") score += 15;

  if (p.leadType === "HIGH_INTENT_OWNER") score += 10;
  else if (p.leadType === "HIGH_INTENT") score += 7;
  else if (p.leadType === "MEDIUM_INTENT_OWNER") score += 5;
  else score += 2;

  if (/need leads|buy leads|lead source|lead list|lead database/.test(t)) score += 5;
  if (/looking for (a |an )?(developer|dev|programmer)/.test(t)) score += 8;
  if (/budget|willing to pay|will pay|paid/.test(t)) score += 6;
  if (["forhire","slavelabour","jobs4bitcoins","WorkOnline","HireaWriter"].includes(sub)) score += 5;
  if (["sales","b2bsales","coldemail","coldcalling","leadgeneration"].includes(sub)) score += 5;

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
    const trigger   = (post.matchedTrigger || "").trim();
    const leadType  = (post.leadType || "").trim();
    const subreddit = (post.subreddit || "").trim();
    const product   = (post.product || "MAPZAP").trim().toUpperCase();
    if (!username || !url) continue;
    const key  = username.toLowerCase();
    const user = getUser(users, username);
    if (cyclesSeen.has(key)) continue;
    if (user?.sent) { log("SKIP", `already contacted u/${username}`); continue; }
    if (user?.closed) { log("SKIP", `closed u/${username} (${user.closed_reason})`); continue; }
    cyclesSeen.add(key);
    attempted++;

    // Pick the right message based on product
    const tpl = product === "DEVHIRE" ? pick(DEVHIRE_MESSAGES) : pick(MAPZAP_MESSAGES);

    try {
      await reddit.composeMessage({ to: username, subject: "", text: tpl.text });
      confirmed++;
      log("SENT", `u/${username} | ${tpl.id} | [${product}] | score:${scoreLead(post)} | ${leadType}`);
      upsertUser(users, username, {
        username, product,
        sent: true, sent_at: new Date().toISOString(), template: tpl.id,
        replied: false, reply_positive: false,
        closer_sent: false, closed: false, closed_reason: null,
        processed_message_ids: [], trigger, leadType, url, subreddit
      });
      await sentWriter.writeRecords([{
        time: new Date().toISOString(), username, step: "OUTREACH", templateId: tpl.id,
        subreddit, leadType, trigger, url, product, note: "initial DM"
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
      // DevHire replies always go to human -- no auto closer
      if (user.product === "DEVHIRE") {
        log("NEEDS HUMAN", `u/${item.author.name} [DEVHIRE] replied -- CHECK YOUR REDDIT INBOX NOW`);
        continue;
      }
      // MapZap closer -- fires ONCE only
      if (user.closer_sent) {
        log("NEEDS HUMAN", `u/${item.author.name} replied after closer -- CHECK YOUR REDDIT INBOX`);
        continue;
      }
      log("REPLY", `u/${item.author.name} -- sending MapZap closer once`);
      const closer = pick(MAPZAP_CLOSERS);
      try {
        await reddit.composeMessage({
          to: item.author.name,
          subject: "",
          text: closer.text
        });
        log("CLOSER SENT", `u/${item.author.name} | ${closer.id} -- bot done, human takes over`);
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

/* =========================
   MAIN
========================= */
(async () => {
  console.log("=".repeat(60));
  console.log("ClientMagnet -- MapZap + DevHire Outreach Bot");
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
