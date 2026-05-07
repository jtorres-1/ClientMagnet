// agency_bot.cjs — ClientMagnet Outreach (Dev Job Kit)
// 2-Step Conversational System — Fully Idempotent
//   Step 1: Context-aware opener, NO link — sent ONCE per user
//   Step 2: On reply → value + tracking link — sent ONCE per user
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

const leadsPath  = path.join(baseDir, "clean_leads.csv");
const sentPath   = path.join(baseDir, "clean_leads_dmed.csv");
const usersPath  = path.join(baseDir, "contacted_users.json");

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
   If reply contains any of these → close user, skip Step 2
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
   CONTACTED USERS — SINGLE SOURCE OF TRUTH
   Structure per user:
   {
     username:               string
     step1_sent:             bool
     step1_sent_at:          ISO string
     step1_template:         string
     step2_sent:             bool
     step2_sent_at:          ISO string | null
     step2_value_template:   string | null
     step2_link_template:    string | null
     replied:                bool
     closed:                 bool   ← negative reply or blocked
     closed_reason:          string | null
     last_message_at:        ISO string
     processed_message_ids:  string[]  ← never reprocess same reply
     trigger:                string
     leadType:               string
     url:                    string
     subreddit:              string
   }
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
   CSV WRITER — SENT LOG
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
   STEP 1 TEMPLATES — OPENERS (NO LINK)
   6 categories × 3 variants = 18 openers
========================= */
const OPENERS = {
  no_response: [
    { id: "O_NR1", text: `yo saw your post about getting no responses — that's genuinely demoralizing\n\nquick question: are you tailoring your resume for each job or mostly sending the same one?` },
    { id: "O_NR2", text: `saw your post about no callbacks — rough spot to be in\n\nhonest question: when you apply, do you rewrite your resume bullets for each role or keep it the same?` },
    { id: "O_NR3", text: `noticed your post about getting ghosted — that grind is brutal\n\nare you customizing your application for each job or sending the same resume out?` }
  ],
  volume: [
    { id: "O_V1", text: `saw your post about sending out that many applications — respect for the grind\n\nbut real question: are you tailoring each one or mostly using the same resume?` },
    { id: "O_V2", text: `noticed your post about the application volume with no results — that's exhausting\n\nquick thing: are you customizing your resume for each job description or keeping it generic?` },
    { id: "O_V3", text: `saw your post — applying that much with nothing back is demoralizing\n\nhonest question: do you rewrite your bullets for each role or send the same version out?` }
  ],
  resume: [
    { id: "O_R1", text: `saw your post about the resume struggles — it's one of those things that feels like it should be simple but isn't\n\nare you tailoring it to each job description or keeping one version?` },
    { id: "O_R2", text: `noticed your post about the resume — are you rewriting your bullets for each job or mostly keeping the same resume?` },
    { id: "O_R3", text: `saw your post about the resume situation — quick question: do you customize it for each role or send the same one out?` }
  ],
  cover_letter: [
    { id: "O_CL1", text: `saw your post about the cover letter — most people either skip it or write something generic\n\ndo you write a new one for each job or reuse the same one?` },
    { id: "O_CL2", text: `noticed your post about cover letters — are you writing a custom one per application or mostly copying the same version?` },
    { id: "O_CL3", text: `saw your post — cover letters are genuinely painful to write from scratch every time\n\nare you customizing yours for each role or keeping it the same?` }
  ],
  laid_off: [
    { id: "O_LO1", text: `saw your post — getting laid off and having to job hunt immediately is a brutal combo\n\nare you tailoring your resume for each role you apply to or mostly sending the same version?` },
    { id: "O_LO2", text: `noticed your post — that situation is tough, job hunting under pressure is no joke\n\nquick question: do you customize your resume and cover letter for each job or keep it the same?` },
    { id: "O_LO3", text: `saw your post about the job search — hope it turns around soon\n\nhonest question: are you rewriting your resume for each role or sending the same one out?` }
  ],
  general: [
    { id: "O_G1", text: `saw your post about the job search — that process is rough\n\nquick question: are you tailoring your resume for each job or sending the same version out?` },
    { id: "O_G2", text: `noticed your post — job hunting is genuinely exhausting\n\nare you customizing your resume and cover letter for each role or mostly keeping it the same?` },
    { id: "O_G3", text: `saw your post — that job search grind hits different\n\nhonest question: do you rewrite your resume for each application or send one version out?` }
  ]
};

/* =========================
   STEP 2A TEMPLATES — VALUE (NO LINK)
========================= */
const FOLLOWUP_VALUE = [
  { id: "FV1", text: `yeah that's usually the issue — most people send the same resume and ATS filters it out before a human even sees it\n\ni built a tool that rewrites your resume bullets + cover letter for each job automatically` },
  { id: "FV2", text: `right — sending the same resume is basically why most apps go nowhere. each job description has specific keywords and if your resume doesn't match, it gets filtered\n\ni actually built something that handles the tailoring automatically` },
  { id: "FV3", text: `yeah exactly — the tailoring is what makes the difference but it's also the most time consuming part\n\nbuilt a tool that does it for you — takes your resume + the job description and rewrites everything` },
  { id: "FV4", text: `makes sense — doing it manually for every job is brutal and most people just don't\n\ni built a tool that automates the whole thing — resume bullets, cover letter, and a why-you-fit paragraph` }
];

/* =========================
   STEP 2B TEMPLATES — LINK (WITH TRACKING)
   USERNAME injected at send time → ?u=USERNAME
========================= */
const FOLLOWUP_LINK = [
  { id: "FL1", text: (u) => `made this for exactly that: https://jobkit.tech/?u=${u}\npaste your resume + the job post — it rewrites your bullets and cover letter to match. takes 30 seconds` },
  { id: "FL2", text: (u) => `here: https://jobkit.tech/?u=${u}\nit tailors your resume to each job description so you stop getting filtered out before anyone reads it` },
  { id: "FL3", text: (u) => `https://jobkit.tech/?u=${u}\npaste your resume + the posting, it rewrites everything to match — most people start getting callbacks within a week` }
];

/* =========================
   HELPERS
========================= */
function getOpenerCategory(trigger) {
  const t = (trigger || "").toLowerCase();
  if (/no callbacks|no response|no interviews|ghosted|not hearing/.test(t)) return "no_response";
  if (/applied to|hundreds|mass applying|applications/.test(t))             return "volume";
  if (/resume|ats|bullet|tailoring/.test(t))                                return "resume";
  if (/cover letter/.test(t))                                               return "cover_letter";
  if (/laid off|layoff|unemployed|between jobs/.test(t))                    return "laid_off";
  return "general";
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function getOpener(trigger)  { return pick(OPENERS[getOpenerCategory(trigger)]); }
function getValueMsg()       { return pick(FOLLOWUP_VALUE); }
function getLinkMsg()        { return pick(FOLLOWUP_LINK); }

/* =========================
   LEAD SCORING
========================= */
function scoreLead(p) {
  let score = 0;
  const t = (p.matchedTrigger || "").toLowerCase();
  if (p.leadType === "ACTIVE_SEEKER_PAIN") score += 5;
  if (p.leadType === "GENERAL_JOB_PAIN")   score += 3;
  if (/no callbacks|no response/.test(t))  score += 4;
  if (/no interviews/.test(t))             score += 4;
  if (/applied to|hundreds/.test(t))       score += 4;
  if (/ghosted/.test(t))                   score += 3;
  if (/months/.test(t))                    score += 3;
  if (/resume|cover letter/.test(t))       score += 3;
  if (/ats/.test(t))                       score += 3;
  if (/laid off|unemployed/.test(t))       score += 2;
  if (/desperate|hopeless/.test(t))        score += 2;
  if (["cscareerquestions","recruitinghell","resumes"].includes(p.subreddit)) score += 2;
  return score;
}

/* =========================
   LOAD LEADS FROM CSV
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
   OUTREACH CYCLE — STEP 1
   Guard: step1_sent must be false
   Guard: closed must be false
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

    const username = (post.username || "").trim();
    const url      = (post.url      || "").trim();
    const trigger  = (post.matchedTrigger || "the job search").trim();
    const leadType = (post.leadType || "").trim();
    const subreddit = (post.subreddit || "").trim();

    if (!username || !url) continue;

    const key  = username.toLowerCase();
    const user = getUser(users, username);

    // ── DEDUPLICATION GUARDS ──
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
        step2_link_template:  null,
        replied:              false,
        closed:               false,
        closed_reason:        null,
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

  log("INFO", `Outreach cycle complete — attempted ${attempted}, confirmed ${confirmed}`);
}

/* =========================
   INBOX MONITOR — STEP 2
   Guards:
     - Real DM only (was_comment === false)
     - Not from our own account
     - User must be in contacted_users with step1_sent = true
     - step2_sent must be false
     - Message ID must not be in processed_message_ids
     - Negative reply → close user, skip Step 2
========================= */
async function checkInboxAndFollowup() {
  const users = loadUsers();
  const botUsername = (process.env.REDDIT_USERNAME || "").toLowerCase();

  try {
    const unread     = await reddit.getUnreadMessages({ limit: 50 });
    const toMarkRead = [];

    for (const item of unread) {

      // Must be a real DM
      if (item.was_comment !== false) continue;
      if (!item.body)                 continue;
      if (!item.author)               continue;

      toMarkRead.push(item);

      const sender    = item.author.name.toLowerCase();
      const messageId = item.name || item.id || "";

      // Never process our own sent messages
      if (sender === botUsername) continue;

      const user = getUser(users, item.author.name);

      // Must be someone we contacted in Step 1
      if (!user || !user.step1_sent) {
        log("SKIP", `unknown sender u/${item.author.name} — not in contacted_users`);
        continue;
      }

      // Skip closed users
      if (user.closed) {
        log("SKIP", `closed user u/${item.author.name} (${user.closed_reason})`);
        continue;
      }

      // Never process same message twice
      const processed = user.processed_message_ids || [];
      if (messageId && processed.includes(messageId)) {
        log("SKIP", `already processed message ${messageId} from u/${item.author.name}`);
        continue;
      }

      // Mark message ID as processed immediately
      processed.push(messageId);
      upsertUser(users, item.author.name, { processed_message_ids: processed, replied: true });

      // ── NEGATIVE REPLY FILTER ──
      if (isNegativeReply(item.body)) {
        upsertUser(users, item.author.name, {
          closed: true,
          closed_reason: "negative_reply"
        });
        log("SKIP: negative reply", `u/${item.author.name} — closing user`);
        continue;
      }

      // ── STEP 2 DEDUPLICATION GUARD ──
      if (user.step2_sent) {
        log("SKIP: step2 already sent", `u/${item.author.name}`);
        continue;
      }

      log("INFO", `Reply detected from u/${item.author.name}`);

      const valTpl  = getValueMsg();
      const linkTpl = getLinkMsg();

      try {
        // Step 2a — value, no link
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

        // Wait 10–30s before link
        const pause = FOLLOWUP_MIN_MS + Math.random() * (FOLLOWUP_MAX_MS - FOLLOWUP_MIN_MS);
        log("INFO", `Pausing ${Math.round(pause/1000)}s before link...`);
        await sleep(pause);

        // Step 2b — tracking link with username
        const linkText = linkTpl.text(item.author.name);
        await reddit.composeMessage({
          to:      item.author.name,
          subject: "re: quick question",
          text:    linkText
        });
        log("SENT: step2b", `u/${item.author.name} | ${linkTpl.id} | link: https://jobkit.tech/?u=${item.author.name}`);

        await sentWriter.writeRecords([{
          time: new Date().toISOString(), username: item.author.name,
          step: "STEP_2B", templateId: linkTpl.id,
          subreddit: user.subreddit || "", leadType: user.leadType || "",
          trigger: user.trigger || "", url: user.url || "",
          note: `tracking: https://jobkit.tech/?u=${item.author.name}`
        }]);

        // ── MARK STEP 2 COMPLETE — will never fire again for this user ──
        upsertUser(users, item.author.name, {
          step2_sent:           true,
          step2_sent_at:        new Date().toISOString(),
          step2_value_template: valTpl.id,
          step2_link_template:  linkTpl.id
        });

      } catch (err) {
        log("ERROR", `Step 2 failed u/${item.author.name}: ${err.message}`);
      }
    }

    // Mark all processed items as read on Reddit
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
  console.log("ClientMagnet — Dev Job Kit 2-Step Outreach (Idempotent)");
  console.log("=".repeat(60));
  console.log(`Step 1 DMs per cycle:  ${MIN_DMS_PER_CYCLE}–${MAX_DMS_PER_CYCLE}`);
  console.log(`Delay between DMs:     ${MIN_DELAY_MS/60000}–${MAX_DELAY_MS/60000} min`);
  console.log(`Inbox poll interval:   ${INBOX_POLL_MS/1000}s`);
  console.log(`Follow-up split delay: ${FOLLOWUP_MIN_MS/1000}–${FOLLOWUP_MAX_MS/1000}s`);
  console.log(`State file:            logs/contacted_users.json`);
  console.log("=".repeat(60));

  // Inbox monitor — non-blocking
  setInterval(checkInboxAndFollowup, INBOX_POLL_MS);

  // Outreach loop
  while (true) {
    console.log(`\n[${new Date().toLocaleString()}] Starting outreach cycle...`);
    await runOutreachCycle();

    const cycleDelay = (8 + Math.floor(Math.random() * 4)) * 60 * 1000;
    log("INFO", `Next cycle in ${Math.round(cycleDelay/60000)} minutes...`);
    await sleep(cycleDelay);
  }
})();
