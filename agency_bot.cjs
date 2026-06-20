// agency_bot.cjs ClientMagnet MapZap + DevHire + FlowMate + AutoSub Outreach
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
const FOLLOWUP_DELAY_MS = 48 * 60 * 60 * 1000; // 48 hours

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

// ─── REPLY CLASSIFICATION ────────────────────────────────────────────────────
const positiveReplyRegex = /\b(interested|tell me more|how does it work|how much|what's the price|what is the price|sounds good|yes|yeah|sure|how do i|sign me up|i want|send me|where do i|how do i get|let's do it|lets do it|can you|would this work|does it work for|more info|more information|what do you|how does|can i see|show me|demo|trial|how to get started|getting started|i'd like|i would like|this looks|this sounds|great|awesome|nice|cool|exactly what|been looking for|need this)\b/i;

const negativeReplyRegex = /\b(not interested|no thanks|no thank you|stop messaging|stop dming|don't message|do not message|remove me|unsubscribe|leave me alone|wrong person|not for me|not relevant|spam|reported|i'm good|im good|i'm all set|im all set|already have|don't need|do not need|not looking|not right now|maybe later|no need|pass|nope|nah|go away|f off|piss off|scam|bot)\b/i;

function classifyReply(text) {
  const t = (text || "").toLowerCase();
  if (negativeReplyRegex.test(t)) return "NEGATIVE";
  if (positiveReplyRegex.test(t)) return "POSITIVE";
  return "UNCLEAR";
}

// ─── MAPZAP MESSAGES ─────────────────────────────────────────────────────────
const MAPZAP_MESSAGES = [
  {
    id: "MZ_1",
    text: `saw your post. if you're building lead lists manually i built something that does it in 60 seconds\n\ntype a business type and city, get 100 contacts instantly. name, phone, address, website, email. CSV download, unlimited searches\n\nfree preview at [mapzap.org](https://mapzap.org) no card needed`
  },
  {
    id: "MZ_2",
    text: `saw your post. i built mapzap for exactly this\n\ntype a niche and city, get 100 local business contacts in under a minute. name, phone, address, website, email where available. $19.99 per month unlimited searches\n\ntry it free at [mapzap.org](https://mapzap.org)`
  },
  {
    id: "MZ_3",
    text: `this might help. i built a tool that finds 100 local business contacts in 60 seconds\n\nname, phone, address, website, email. CSV you can drop straight into your outreach. $19.99 per month, free preview available\n\n[mapzap.org](https://mapzap.org)`
  },
  {
    id: "MZ_4",
    text: `saw your post. instead of spending hours building lists manually i built something that does it instantly\n\n100 local business contacts per search. phone, email, address, website. $19.99 per month unlimited, cancel anytime\n\nfree preview at [mapzap.org](https://mapzap.org) no card needed`
  },
  {
    id: "MZ_5",
    text: `thought this might save you some time. i built a lead scraper that returns 100 local businesses from any city in under a minute\n\nCSV with name, phone, address, website, email. $19.99 per month unlimited searches\n\n[mapzap.org](https://mapzap.org)`
  }
];

const MAPZAP_FOLLOWUP_MESSAGES = [
  {
    id: "MZ_FU_1",
    text: `just following up on my last message\n\nmapzap has a free preview so you can try it before paying anything. no card needed\n\n[mapzap.org](https://mapzap.org)`
  },
  {
    id: "MZ_FU_2",
    text: `wanted to follow up. if you're still looking for a faster way to build lead lists, the free preview at mapzap.org lets you run a real search before committing\n\n[mapzap.org](https://mapzap.org)`
  }
];

// ─── DEVHIRE BOT MESSAGES ────────────────────────────────────────────────────
// For DEV_HIRE_BOT leads — broken bots, automation, scrapers
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
// For DEV_HIRE_GENERAL leads — websites, apps, general dev work
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

const DEVHIRE_FOLLOWUP_MESSAGES = [
  {
    id: "DH_FU_1",
    text: `just following up. still available if you need something built or fixed. flat fee, 48 hour turnaround\n\nrecent work: [autosub.online](https://autosub.online) and [mapzap.org](https://mapzap.org)\n\ndm me what you need`
  }
];

// ─── FLOWMATE MESSAGES ────────────────────────────────────────────────────────
const FLOWMATE_MESSAGES = [
  {
    id: "FM_1",
    text: `saw your post. roughly 78% of customers go with whoever responds first, so if a lead sits for even 10 minutes you're losing it to a competitor\n\ni built flowmate, it automatically texts and emails every new lead within 60 seconds, runs 24/7, you never touch it\n\n$297 first month to test it, $797/month after if it's working\n\n[flowmate.live](https://flowmate.live)`
  },
  {
    id: "FM_2",
    text: `saw your post. this is exactly what flowmate solves\n\ni set up an automation that texts and emails every new lead within 60 seconds of them reaching out. runs in the background forever, no software for you to learn, i build and run it for you\n\n$297 first month, $797/month after\n\n[flowmate.live](https://flowmate.live)`
  },
  {
    id: "FM_3",
    text: `saw your post. i built flowmate for exactly this\n\nautomatic text and email to every new lead within 60 seconds, 24/7. you stop losing business to whoever calls back first. i build it and run it, nothing for you to manage\n\n$297 first month, $797/month ongoing\n\n[flowmate.live](https://flowmate.live)`
  },
  {
    id: "FM_4",
    text: `saw your post. if you're getting leads from ads or google and not responding instantly, you're losing most of them\n\ni built flowmate to fix that. auto texts and emails every new lead in under 60 seconds, 24/7, nothing for you to manage\n\n$297 to try the first month, $797/month after\n\n[flowmate.live](https://flowmate.live)`
  },
  {
    id: "FM_5",
    text: `saw your post. this is a lead response problem not a marketing problem\n\ni build done for you automations that text and email every new lead within 60 seconds so you're always first to respond. runs 24/7, nothing to manage\n\n$297 first month, $797/month after\n\n[flowmate.live](https://flowmate.live)`
  }
];

const FLOWMATE_FOLLOWUP_MESSAGES = [
  {
    id: "FM_FU_1",
    text: `just following up. flowmate has helped businesses cut lead response time from hours to under 60 seconds\n\nif you're still losing leads to slow follow up it might be worth a look\n\n[flowmate.live](https://flowmate.live)`
  }
];

// ─── AUTOSUB MESSAGES ─────────────────────────────────────────────────────────
const AUTOSUB_MESSAGES = [
  {
    id: "AS_1",
    text: `saw your post. i built a tool that finds people on Reddit actively looking for what you sell and DMs them for you automatically, 24/7\n\nyou connect your account, set your keywords and offer once, and it runs while you sleep. 200+ targeted DMs per day on autopilot\n\n$19.99/month. [autosub.online](https://autosub.online)`
  },
  {
    id: "AS_2",
    text: `saw your post. instead of spending hours on Reddit outreach manually i built something that automates the whole thing\n\nfinds buyers posting about needing what you sell and DMs them automatically. set it up once, runs 24/7\n\n$19.99/month. [autosub.online](https://autosub.online)`
  },
  {
    id: "AS_3",
    text: `saw your post. i built autosub to solve exactly this\n\nconnect your Reddit account, set your keywords and pitch once, and it finds buyers and DMs them automatically around the clock. no manual work\n\n$19.99/month. [autosub.online](https://autosub.online)`
  },
  {
    id: "AS_4",
    text: `saw your post. i built a Reddit outreach bot that runs 24/7\n\nit finds people actively posting about needing what you sell and messages them automatically while you focus on the work. 200+ targeted DMs per day\n\n$19.99/month, cancel anytime. [autosub.online](https://autosub.online)`
  },
  {
    id: "AS_5",
    text: `saw your post. cold outreach on Reddit doesn't have to be manual\n\ni built autosub, it scans Reddit for buyers in your niche and DMs them for you automatically 24/7. you set it up once and it runs forever\n\n$19.99/month. [autosub.online](https://autosub.online)`
  }
];

const AUTOSUB_FOLLOWUP_MESSAGES = [
  {
    id: "AS_FU_1",
    text: `following up on my last message. autosub has a straightforward setup and starts finding leads the same day\n\nif you're still looking to scale your Reddit outreach it might be worth trying\n\n$19.99/month. [autosub.online](https://autosub.online)`
  }
];

// ─── SCORING ──────────────────────────────────────────────────────────────────
function scoreLead(p) {
  let score = 0;
  const t = (p.matchedTrigger || "").toLowerCase();
  const sub = (p.subreddit || "").toLowerCase();
  const product = (p.product || "MAPZAP").toUpperCase();
  const leadType = (p.leadType || "").toUpperCase();

  if (product === "FLOWMATE") score += 22;
  if (product === "AUTOSUB") score += 18;
  if (product === "DEVHIRE") score += 15;

  if (leadType === "DEV_HIRE_BOT") score += 20;
  if (leadType === "DEV_HIRE_GENERAL") score += 12;
  if (leadType === "FLOWMATE_OWNER") score += 16;
  else if (leadType === "FLOWMATE_INTENT") score += 12;
  if (leadType === "AUTOSUB_INTENT") score += 14;
  if (leadType === "HIGH_INTENT_OWNER") score += 10;
  else if (leadType === "HIGH_INTENT") score += 7;
  else if (leadType === "MEDIUM_INTENT_OWNER") score += 5;
  else score += 2;

  if (/need leads|buy leads|lead source|lead list|lead database/.test(t)) score += 5;
  if (/broken bot|bot stopped|automation broke|fix my bot|scraper stopped/.test(t)) score += 12;
  if (/looking for (a |an )?(developer|dev|programmer)/.test(t)) score += 8;
  if (/lose(s)? leads|losing leads|leads (go|going) cold|respond(ing)? (too )?(slow|late)|slow to respond|follow up|forget to|miss(ing)? leads|never miss a lead|GoHighLevel/.test(t)) score += 10;
  if (/automate|outreach|dms|reddit marketing/.test(t)) score += 10;
  if (/budget|willing to pay|will pay|paid/.test(t)) score += 6;

  if (["forhire","slavelabour","jobs4bitcoins","WorkOnline","HireaWriter"].includes(sub)) score += 5;
  if (["sales","b2bsales","coldemail","coldcalling","leadgeneration","smallbusiness","realtors"].includes(sub)) score += 5;
  if (["agency","digital_marketing","PPC","Entrepreneur","Affiliatemarketing"].includes(sub)) score += 8;
  if (["plumbing","HVAC","electricians","Roofing","Contractors","smallbusiness","Construction"].includes(sub)) score += 8;

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

// ─── FOLLOW-UP CYCLE ─────────────────────────────────────────────────────────
async function runFollowUpCycle() {
  const users = loadUsers();
  const now = Date.now();

  for (const [key, user] of Object.entries(users)) {
    if (!user.sent) continue;
    if (user.closed) continue;
    if (user.replied) continue;
    if (user.followup_sent) continue;

    const sentAt = user.sent_at ? new Date(user.sent_at).getTime() : 0;
    if (now - sentAt < FOLLOWUP_DELAY_MS) continue;

    const product = (user.product || "MAPZAP").toUpperCase();
    const leadType = (user.leadType || "").toUpperCase();

    let tpl, subject;
    if (product === "FLOWMATE") {
      tpl = pick(FLOWMATE_FOLLOWUP_MESSAGES);
      subject = "following up";
    } else if (product === "AUTOSUB") {
      tpl = pick(AUTOSUB_FOLLOWUP_MESSAGES);
      subject = "following up";
    } else if (product === "DEVHIRE") {
      tpl = pick(DEVHIRE_FOLLOWUP_MESSAGES);
      subject = "following up";
    } else {
      tpl = pick(MAPZAP_FOLLOWUP_MESSAGES);
      subject = "following up";
    }

    try {
      await reddit.composeMessage({ to: user.username, subject, text: tpl.text });
      log("FOLLOWUP", `u/${user.username} | ${tpl.id} | [${product}]`);
      upsertUser(users, user.username, {
        followup_sent: true,
        followup_sent_at: new Date().toISOString(),
        followup_template: tpl.id
      });
      await sentWriter.writeRecords([{
        time: new Date().toISOString(),
        username: user.username,
        step: "FOLLOWUP",
        templateId: tpl.id,
        subreddit: user.subreddit || "",
        leadType: user.leadType || "",
        trigger: user.trigger || "",
        url: user.url || "",
        product,
        note: "48hr follow-up"
      }]);
      await sleep(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
    } catch (err) {
      log("ERROR", `Follow-up failed u/${user.username}: ${err.message}`);
    }
  }
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
      const user = getUser(users, item.author.name);

      if (replyType === "NEGATIVE") {
        log("REPLY_NEG", `u/${item.author.name} not interested — closing lead`);
        upsertUser(users, item.author.name, {
          replied: true,
          reply_type: "NEGATIVE",
          closed: true,
          closed_reason: "not_interested"
        });
      } else if (replyType === "POSITIVE") {
        // Flag loudly for manual handling — do NOT auto-respond
        log("HOT_LEAD", `\n${"=".repeat(60)}\nHOT LEAD — CHECK YOUR REDDIT INBOX NOW\nu/${item.author.name} replied with interest\nMessage: "${item.body.slice(0, 200)}"\n${"=".repeat(60)}`);
        upsertUser(users, item.author.name, {
          replied: true,
          reply_type: "POSITIVE",
          reply_body: item.body.slice(0, 500),
          closed: false
        });
      } else {
        // Unclear — flag for manual review
        log("REPLY_UNCLEAR", `u/${item.author.name} replied — REVIEW MANUALLY\nMessage: "${item.body.slice(0, 200)}"`);
        upsertUser(users, item.author.name, {
          replied: true,
          reply_type: "UNCLEAR",
          reply_body: item.body.slice(0, 500),
          closed: false
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

  // Deduplicate leads by username before sorting
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
    if (product === "FLOWMATE") {
      tpl = pick(FLOWMATE_MESSAGES);
      subject = "stop losing leads to slow follow up";
    } else if (product === "AUTOSUB") {
      tpl = pick(AUTOSUB_MESSAGES);
      subject = "automate your Reddit outreach";
    } else if (product === "DEVHIRE") {
      // Split by lead type — bot/automation vs general dev
      if (leadType === "DEV_HIRE_BOT") {
        tpl = pick(DEVHIRE_BOT_MESSAGES);
        subject = "bot and automation dev for hire";
      } else {
        tpl = pick(DEVHIRE_GENERAL_MESSAGES);
        subject = "dev for hire";
      }
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
      log("SENT", `u/${username} | ${tpl.id} | [${product}/${leadType}] | score:${scoreLead(post)}`);

      upsertUser(users, username, {
        username, product, leadType,
        sent: true, sent_at: new Date().toISOString(), template: tpl.id,
        replied: false, reply_type: null, reply_body: null,
        followup_sent: false, followup_sent_at: null,
        closed: false, closed_reason: null,
        processed_message_ids: [], trigger, url, subreddit
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

// ─── MAIN LOOP ───────────────────────────────────────────────────────────────
(async () => {
  console.log("=".repeat(60));
  console.log("ClientMagnet MapZap + DevHire + FlowMate + AutoSub Outreach Bot");
  console.log("=".repeat(60));

  // Check inbox every minute
  setInterval(checkInbox, INBOX_POLL_MS);

  // Check follow-ups every hour
  setInterval(runFollowUpCycle, 60 * 60 * 1000);

  while (true) {
    console.log(`\n[${new Date().toLocaleString()}] Starting outreach cycle...`);
    await runOutreachCycle();
    const cycleDelay = (6 + Math.floor(Math.random() * 3)) * 60 * 1000;
    log("INFO", `Next cycle in ${Math.round(cycleDelay/60000)} minutes...`);
    await sleep(cycleDelay);
  }
})();
