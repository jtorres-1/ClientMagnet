// agency_bot.cjs ClientMagnet MapZap + DevHire + CallDone + AgencyHire + AutoSub Outreach
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

const MAPZAP_MESSAGES = [
  {
    id: "MZ_1",
    text: `not sure if this helps but i built a tool that pulls 100 local business leads as a CSV in about 60 seconds\n\nyou type a business type and city, it returns names, phone numbers, addresses, and websites. $49 per month, unlimited searches. free preview at mapzap.org no card needed\n\n[mapzap.org](https://mapzap.org)`
  },
  {
    id: "MZ_2",
    text: `might be relevant\n\ni built mapzap, pulls 100 local business leads (name, phone, address, website) as a CSV in under a minute. $49 per month unlimited searches, free preview available\n\n[mapzap.org](https://mapzap.org)`
  },
  {
    id: "MZ_3",
    text: `this might save you some time built a tool that scrapes 100 local business leads in 60 seconds\n\ntype a niche and city, get a CSV with names, phones, addresses, websites. $49 per month unlimited\n\n[mapzap.org](https://mapzap.org)`
  },
  {
    id: "MZ_4",
    text: `building lead lists manually is a nightmare i built something that does it in 60 seconds\n\n100 local businesses, names, phone numbers, addresses, websites, CSV download. $49 per month unlimited searches, cancel anytime\n\n[mapzap.org](https://mapzap.org)`
  },
  {
    id: "MZ_5",
    text: `thought this might help i built a lead scraper that pulls 100 local businesses from any city in 60 seconds\n\nCSV with name, phone, address, website. $49 per month unlimited searches, free preview no card needed\n\n[mapzap.org](https://mapzap.org)`
  }
];

const DEVHIRE_MESSAGES = [
  {
    id: "DH_1",
    text: `i'm a python developer based in LA available for immediate freelance work. i've built a live google maps scraper SaaS at mapzap.org with stripe payments, a cold email pipeline pushing 500 emails per day, and a reddit automation bot in production. websites, scrapers, bots, ai integrations. 48 hour delivery, flat fee.\n\nrecent work: [claudiascleaningla.com](https://claudiascleaningla.com) and [mapzap.org](https://mapzap.org)\n\ndm me a scope`
  },
  {
    id: "DH_2",
    text: `python developer in LA, available now, i ship fast. built mapzap.org (live SaaS, google maps scraper with stripe), a 500 email per day cold outreach pipeline, and a reddit automation bot all in production.\n\nwebsites, scrapers, automation, ai integrations. flat fee, 48 hour delivery.\n\nrecent work: [claudiascleaningla.com](https://claudiascleaningla.com) and [mapzap.org](https://mapzap.org)\n\nwhat do you need built`
  },
  {
    id: "DH_3",
    text: `python dev here, based in LA, available now. i have live production projects including mapzap.org (google maps lead scraper SaaS), a cold email pipeline, and a reddit dm bot.\n\ni do websites, scrapers, automation bots, and ai integrations. 48 hour turnaround, flat fee.\n\nrecent work: [claudiascleaningla.com](https://claudiascleaningla.com) and [mapzap.org](https://mapzap.org)\n\ndm me what you need`
  }
];

const CALLDONE_MESSAGES = [
  {
    id: "CD_1",
    text: `this might help i built an AI receptionist called CallDone that answers every call 24/7, handles questions, and texts you a summary after each call. $500/month, live in 48 hours, no setup fee.\n\ncall the demo line right now and hear it yourself: (563) 287-1146\n\n[calldone.org](https://calldone.org)`
  },
  {
    id: "CD_2",
    text: `might be relevant built an AI phone receptionist that answers calls 24/7 for local businesses. handles FAQs, captures leads, books appointments, and texts you a summary instantly. $500/month flat, no contracts, live in 48 hours.\n\nfree demo: call (563) 287-1146\n\n[calldone.org](https://calldone.org)`
  },
  {
    id: "CD_3",
    text: `sounds like CallDone could help it's an AI receptionist that answers every call 24/7 so you never miss a customer. trained on your business, handles questions and bookings, texts you after every call. $500/month, no setup fee, cancel anytime.\n\nhear it live: (563) 287-1146\n\n[calldone.org](https://calldone.org)`
  },
  {
    id: "CD_4",
    text: `built something for exactly this CallDone answers every call to your business 24/7. sounds like a real person, handles FAQs, captures caller info, texts you a summary. $500/month, live in 48 hours.\n\ncall (563) 287-1146 to hear the demo\n\n[calldone.org](https://calldone.org)`
  },
  {
    id: "CD_5",
    text: `this is exactly what CallDone solves AI receptionist that answers your business calls 24/7, captures leads, handles common questions, and sends you a text summary after every call. no setup fee, $500/month, cancel anytime.\n\ndemo: (563) 287-1146 [calldone.org](https://calldone.org)`
  }
];

const AGENCYHIRE_MESSAGES = [
  {
    id: "AH_1",
    text: `i built an automated outreach system that sends 1000+ targeted messages per day across Reddit, Facebook, Discord, and X to your ideal clients. runs 24/7, finds buyers actively looking for your service, DMs them automatically.\n\ni deploy the full stack on your accounts in 48 hours. $1,500 flat fee to set up, $500/month retainer to keep it running.\n\nproof it works: [mapzap.org](https://mapzap.org) (built and marketed entirely with this system)\n\ndeposit to start: [pay deposit here](https://buy.stripe.com/9B6eVd7vteL23kedQ22Ry0d)\n\ndm me if you want to see exactly how it works`
  },
  {
    id: "AH_2",
    text: `this might solve your client acquisition problem i run an outreach automation stack that hits Reddit, Facebook, Discord, and X simultaneously. finds people actively looking for your service and messages them automatically. 1000+ targeted contacts per day.\n\nset it up on your agency in 48 hours for $1,500 flat. $500/month to maintain. you own it.\n\nbuilt and proved on my own products: [mapzap.org](https://mapzap.org)\n\nstart here: [pay deposit here](https://buy.stripe.com/9B6eVd7vteL23kedQ22Ry0d)`
  },
  {
    id: "AH_3",
    text: `scaling agency outreach is exactly what i built this for automated system across Reddit, Facebook, Discord, and X. targets your niche, sends 1000+ messages per day to verified buyers, runs while you sleep.\n\n$1,500 to deploy on your accounts, 48 hour delivery. $500/month retainer after that.\n\nlive proof: [mapzap.org](https://mapzap.org)\n\ndeposit link: [pay deposit here](https://buy.stripe.com/9B6eVd7vteL23kedQ22Ry0d)\n\ndm me a scope`
  },
  {
    id: "AH_4",
    text: `i automate what you're doing manually for your clients full outreach stack across Reddit, Facebook, Discord, and X. finds buyers, messages them, runs 24/7 in the background.\n\ndeploy it on your agency for $1,500 flat, live in 48 hours. $500/month to keep it running after that.\n\nproof: [mapzap.org](https://mapzap.org) (marketed entirely with this stack)\n\n[pay deposit here](https://buy.stripe.com/9B6eVd7vteL23kedQ22Ry0d)`
  }
];

const AUTOSUB_MESSAGES = [
  {
    id: "AS_1",
    text: `hey saw your post\n\ni built a tool that connects to your Reddit account and automatically DMs people who are looking for what you sell. you set your keywords once and it runs 24/7 while you sleep.\n\n200+ targeted DMs per day. $19.99/month. [autosub.online](https://autosub.online)`
  },
  {
    id: "AS_2",
    text: `hey quick question\n\nhow are you currently doing outreach on Reddit? i built something that automates it completely. finds posts from people actively looking for your service and DMs them for you around the clock.\n\ntakes 5 minutes to set up. $19.99/month. [autosub.online](https://autosub.online)`
  },
  {
    id: "AS_3",
    text: `saw your post\n\ni built AutoSub, it connects to your Reddit account, you type in your keywords and offer once, and it finds buyers posting on Reddit and DMs them automatically 24/7.\n\nno manual work. $19.99/month. [autosub.online](https://autosub.online)`
  },
  {
    id: "AS_4",
    text: `this might help\n\nbeen using a bot i built to send 200+ targeted Reddit DMs per day on autopilot. it finds people actively posting about needing what you sell and messages them automatically.\n\n$19.99/month, cancel anytime. [autosub.online](https://autosub.online)`
  },
  {
    id: "AS_5",
    text: `hey\n\ni built a Reddit outreach tool that runs 24/7. you connect your account, set what you sell and your target keywords, and it finds buyers and DMs them automatically while you sleep.\n\n$19.99/month. [autosub.online](https://autosub.online)`
  }
];

function scoreLead(p) {
  let score = 0;
  const t = (p.matchedTrigger || "").toLowerCase();
  const sub = (p.subreddit || "").toLowerCase();
  const product = (p.product || "MAPZAP").toUpperCase();
  if (product === "AGENCYHIRE") score += 20;
  if (product === "AUTOSUB") score += 18;
  if (product === "DEVHIRE") score += 15;
  if (product === "CALLDONE") score += 12;
  if (p.leadType === "AGENCYHIRE_INTENT") score += 15;
  if (p.leadType === "AUTOSUB_INTENT") score += 14;
  if (p.leadType === "HIGH_INTENT_OWNER") score += 10;
  else if (p.leadType === "CALLDONE_OWNER") score += 10;
  else if (p.leadType === "HIGH_INTENT") score += 7;
  else if (p.leadType === "CALLDONE_INTENT") score += 7;
  else if (p.leadType === "MEDIUM_INTENT_OWNER") score += 5;
  else score += 2;
  if (/need leads|buy leads|lead source|lead list|lead database/.test(t)) score += 5;
  if (/looking for (a |an )?(developer|dev|programmer)/.test(t)) score += 8;
  if (/missed calls|missing calls|answering service|receptionist/.test(t)) score += 8;
  if (/agency|smma|scale my agency|get clients for my agency/.test(t)) score += 10;
  if (/automate|outreach|dms|reddit marketing/.test(t)) score += 10;
  if (/budget|willing to pay|will pay|paid/.test(t)) score += 6;
  if (["forhire","slavelabour","jobs4bitcoins","WorkOnline","HireaWriter"].includes(sub)) score += 5;
  if (["sales","b2bsales","coldemail","coldcalling","leadgeneration","smallbusiness","realtors"].includes(sub)) score += 5;
  if (["agency","digital_marketing","PPC","Entrepreneur","Affiliatemarketing"].includes(sub)) score += 8;
  if (["Entrepreneur","agency","Freelance","smallbusiness","marketing"].includes(sub)) score += 6;
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

    let tpl, subject;
    if (product === "AGENCYHIRE") {
      tpl = pick(AGENCYHIRE_MESSAGES);
      subject = "automated outreach system for your agency";
    } else if (product === "AUTOSUB") {
      tpl = pick(AUTOSUB_MESSAGES);
      subject = "automate your Reddit outreach";
    } else if (product === "DEVHIRE") {
      tpl = pick(DEVHIRE_MESSAGES);
      subject = "dev for hire";
    } else if (product === "CALLDONE") {
      tpl = pick(CALLDONE_MESSAGES);
      subject = "AI receptionist for your business";
    } else {
      tpl = pick(MAPZAP_MESSAGES);
      subject = "lead gen tool";
    }

    try {
      const freshUser = getUser(loadUsers(), username);
      if (freshUser?.sent) {
        log("SKIP", `already contacted u/${username} (fresh check)`);
        continue;
      }
      await reddit.composeMessage({ to: username, subject, text: tpl.text });
      confirmed++;
      log("SENT", `u/${username} | ${tpl.id} | [${product}] | score:${scoreLead(post)} | ${leadType}`);
      upsertUser(users, username, {
        username, product,
        sent: true, sent_at: new Date().toISOString(), template: tpl.id,
        replied: false, closed: false, closed_reason: null,
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
  log("INFO", `Outreach cycle complete attempted ${attempted}, confirmed ${confirmed}`);
}

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
      log("REPLY", `u/${item.author.name} replied CHECK YOUR REDDIT INBOX NOW`);
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

(async () => {
  console.log("=".repeat(60));
  console.log("ClientMagnet MapZap + DevHire + CallDone + AgencyHire + AutoSub Outreach Bot");
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
