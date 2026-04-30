// agency_bot.cjs — ClientMagnet Outreach (Dev Job Kit)
// 2-Step Conversational System:
//   Step 1: Context-aware opener, NO link
//   Step 2: On reply → value message + link (split, 10–30s apart)
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
const statePath = path.join(baseDir, "outreach_state.json");

/* =========================
   RATE LIMITS — UNCHANGED
========================= */
const MIN_DMS_PER_CYCLE = 15;
const MAX_DMS_PER_CYCLE = 25;
const MIN_DELAY_MS      = 3 * 60 * 1000;  // 3 min between Step 1 DMs
const MAX_DELAY_MS      = 5 * 60 * 1000;  // 5 min between Step 1 DMs
const INBOX_POLL_MS     = 60 * 1000;       // check inbox every 60s
const FOLLOWUP_MIN_MS   = 10 * 1000;       // 10s between 2a and 2b
const FOLLOWUP_MAX_MS   = 30 * 1000;       // 30s between 2a and 2b

/* =========================
   STATE
   Persists across restarts via JSON.
   {
     messaged:    { "username": { url, trigger, leadType, templateId, sentAt } }
     replied:     { "username": true }
     followed_up: { "username": { at, valueTpl, linkTpl } }
   }
========================= */
function loadState() {
  if (!fs.existsSync(statePath)) return { messaged: {}, replied: {}, followed_up: {} };
  try { return JSON.parse(fs.readFileSync(statePath, "utf8")); }
  catch { return { messaged: {}, replied: {}, followed_up: {} }; }
}

function saveState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
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
  ],
  append: true
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* =========================
   STEP 1 TEMPLATES — OPENERS (NO LINK)

   6 categories matched to scraper trigger:
     no_response  → ghosted, no callbacks, no interviews
     volume       → applied to X, hundreds of apps
     resume       → resume help, ATS, tailoring
     cover_letter → cover letter pain
     laid_off     → layoff, unemployed
     general      → fallback

   3 variants per category = 18 total openers
========================= */
const OPENERS = {
  no_response: [
    {
      id: "O_NR1",
      text: `yo saw your post about getting no responses — that's genuinely demoralizing\n\nquick question: are you tailoring your resume for each job or mostly sending the same one?`
    },
    {
      id: "O_NR2",
      text: `saw your post about no callbacks — rough spot to be in\n\nhonest question: when you apply, do you rewrite your resume bullets for each role or keep it the same?`
    },
    {
      id: "O_NR3",
      text: `noticed your post about getting ghosted — that grind is brutal\n\nare you customizing your application for each job or sending the same resume out?`
    }
  ],
  volume: [
    {
      id: "O_V1",
      text: `saw your post about sending out that many applications — respect for the grind\n\nbut real question: are you tailoring each one or mostly using the same resume?`
    },
    {
      id: "O_V2",
      text: `noticed your post about the application volume with no results — that's exhausting\n\nquick thing: are you customizing your resume for each job description or keeping it generic?`
    },
    {
      id: "O_V3",
      text: `saw your post — applying that much with nothing back is demoralizing\n\nhonest question: do you rewrite your bullets for each role or send the same version out?`
    }
  ],
  resume: [
    {
      id: "O_R1",
      text: `saw your post about the resume struggles — it's one of those things that feels like it should be simple but isn't\n\nare you tailoring it to each job description or keeping one version?`
    },
    {
      id: "O_R2",
      text: `noticed your post about the resume — are you rewriting your bullets for each job or mostly keeping the same resume?`
    },
    {
      id: "O_R3",
      text: `saw your post about the resume situation — quick question: do you customize it for each role or send the same one out?`
    }
  ],
  cover_letter: [
    {
      id: "O_CL1",
      text: `saw your post about the cover letter — most people either skip it or write something generic\n\ndo you write a new one for each job or reuse the same one?`
    },
    {
      id: "O_CL2",
      text: `noticed your post about cover letters — are you writing a custom one per application or mostly copying the same version?`
    },
    {
      id: "O_CL3",
      text: `saw your post — cover letters are genuinely painful to write from scratch every time\n\nare you customizing yours for each role or keeping it the same?`
    }
  ],
  laid_off: [
    {
      id: "O_LO1",
      text: `saw your post — getting laid off and having to job hunt immediately is a brutal combo\n\nare you tailoring your resume for each role you apply to or mostly sending the same version?`
    },
    {
      id: "O_LO2",
      text: `noticed your post — that situation is tough, job hunting under pressure is no joke\n\nquick question: do you customize your resume and cover letter for each job or keep it the same?`
    },
    {
      id: "O_LO3",
      text: `saw your post about the job search — hope it turns around soon\n\nhonest question: are you rewriting your resume for each role or sending the same one out?`
    }
  ],
  general: [
    {
      id: "O_G1",
      text: `saw your post about the job search — that process is rough\n\nquick question: are you tailoring your resume for each job or sending the same version out?`
    },
    {
      id: "O_G2",
      text: `noticed your post — job hunting is genuinely exhausting\n\nare you customizing your resume and cover letter for each role or mostly keeping it the same?`
    },
    {
      id: "O_G3",
      text: `saw your post — that job search grind hits different\n\nhonest question: do you rewrite your resume for each application or send one version out?`
    }
  ]
};

/* =========================
   STEP 2A TEMPLATES — VALUE (NO LINK)
   Sent immediately on reply detection
========================= */
const FOLLOWUP_VALUE = [
  {
    id: "FV1",
    text: `yeah that's usually the issue — most people send the same resume and ATS filters it out before a human even sees it\n\ni built a tool that rewrites your resume bullets + cover letter for each job automatically`
  },
  {
    id: "FV2",
    text: `right — sending the same resume is basically why most apps go nowhere. each job description has specific keywords and if your resume doesn't match, it gets filtered\n\ni actually built something that handles the tailoring automatically`
  },
  {
    id: "FV3",
    text: `yeah exactly — the tailoring is what makes the difference but it's also the most time consuming part\n\nbuilt a tool that does it for you — takes your resume + the job description and rewrites everything`
  },
  {
    id: "FV4",
    text: `makes sense — doing it manually for every job is brutal and most people just don't\n\ni built a tool that automates the whole thing — resume bullets, cover letter, and a why-you-fit paragraph`
  }
];

/* =========================
   STEP 2B TEMPLATES — LINK
   Sent 10–30s after value message
========================= */
const FOLLOWUP_LINK = [
  {
    id: "FL1",
    text: `here it is if you want to try it: https://jobkit.tech\ntakes like 10 seconds per job, $9 one time`
  },
  {
    id: "FL2",
    text: `https://jobkit.tech — paste your resume + the job post and it writes everything for you\n$9 one time, no subscription`
  },
  {
    id: "FL3",
    text: `jobkit.tech if you want to check it out\nyou just paste your resume + the job description and it generates everything in about 10 seconds`
  },
  {
    id: "FL4",
    text: `here: https://jobkit.tech\none-time $9, no account needed — just paste and go`
  }
];

/* =========================
   TRIGGER → OPENER CATEGORY
   Maps scraper matchedTrigger to correct
   opener category so message is coherent
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

function getOpener(trigger) { return pick(OPENERS[getOpenerCategory(trigger)]); }
function getValueMsg()      { return pick(FOLLOWUP_VALUE); }
function getLinkMsg()       { return pick(FOLLOWUP_LINK); }

/* =========================
   LEAD SCORING — unchanged logic
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
   Sends context-aware openers, no link
========================= */
async function runOutreachCycle(state) {
  const leads = await loadLeads();
  if (!leads.length) {
    console.log("No leads found. Waiting for scraper...");
    return;
  }

  leads.sort((a, b) => scoreLead(b) - scoreLead(a));

  const target     = MIN_DMS_PER_CYCLE + Math.floor(Math.random() * (MAX_DMS_PER_CYCLE - MIN_DMS_PER_CYCLE + 1));
  const messaged   = state.messaged || {};
  const cyclesSeen = new Set();

  let attempted = 0;
  let confirmed = 0;

  for (const post of leads) {
    if (attempted >= target) {
      console.log(`Cycle target reached (${target} DMs).`);
      break;
    }

    const username = (post.username || "").trim();
    const url      = (post.url      || "").trim();
    const trigger  = (post.matchedTrigger || "the job search").trim();
    const leadType = (post.leadType || "").trim();

    if (!username || !url)                  continue;
    if (messaged[username.toLowerCase()])   continue;
    if (cyclesSeen.has(username.toLowerCase())) continue;

    cyclesSeen.add(username.toLowerCase());
    attempted++;

    const tpl = getOpener(trigger);

    try {
      await reddit.composeMessage({
        to:      username,
        subject: "quick question",
        text:    tpl.text
      });

      confirmed++;
      console.log(`\n✓ Step 1 → u/${username}`);
      console.log(`  Category:  ${getOpenerCategory(trigger)}`);
      console.log(`  Template:  ${tpl.id}`);
      console.log(`  Trigger:   "${trigger}"`);

      messaged[username.toLowerCase()] = {
        username, url, trigger, leadType,
        templateId: tpl.id,
        sentAt: new Date().toISOString()
      };
      state.messaged = messaged;
      saveState(state);

      await sentWriter.writeRecords([{
        time:       new Date().toISOString(),
        username,
        step:       "STEP_1",
        templateId: tpl.id,
        subreddit:  post.subreddit || "",
        leadType,
        trigger,
        url
      }]);

      if (attempted < target) {
        const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
        console.log(`  Waiting ${Math.round(delay/60000)}m before next DM...`);
        await sleep(delay);
      }

    } catch (err) {
      console.log(`✗ Failed Step 1 → u/${username}: ${err.message}`);
      if (/NOT_WHITELISTED|USER_DOESNT_EXIST|BANNED/.test(err.message)) {
        messaged[username.toLowerCase()] = { blocked: true };
        state.messaged = messaged;
        saveState(state);
      }
    }
  }

  console.log(`\nOutreach cycle complete — attempted ${attempted}, confirmed ${confirmed}`);
}

/* =========================
   INBOX MONITOR — STEP 2
   Polls inbox, detects replies, fires follow-up sequence
   Runs on setInterval — does NOT block outreach loop

   FIX: Uses getUnreadMessages() so we only ever process
   NEW items the bot hasn't seen yet. Marks each item read
   after processing so it never fires twice — even across
   restarts. Also validates item is a real DM (not a comment
   mention or mod notification) before acting on it.
========================= */
async function checkInboxAndFollowup() {
  const state       = loadState();
  const messaged    = state.messaged    || {};
  const followed_up = state.followed_up || {};

  try {
    // getUnreadMessages returns ONLY unread items — no duplicates ever
    const unread = await reddit.getUnreadMessages({ limit: 50 });

    // Collect items to mark as read after processing
    const toMarkRead = [];

    for (const item of unread) {

      // Must be a real DM — not a comment reply, mention, or mod message
      // was_comment === false  → it's a direct message
      // body exists            → has actual content
      // author exists          → not a system message
      if (item.was_comment !== false) continue;
      if (!item.body)                 continue;
      if (!item.author)               continue;

      // Always mark read so we never reprocess, even if we skip it
      toMarkRead.push(item);

      const sender = item.author.name.toLowerCase();

      // Skip our own bot account sending messages
      const botUsername = (process.env.REDDIT_USERNAME || "").toLowerCase();
      if (sender === botUsername) continue;

      if (!messaged[sender])          continue; // not someone we DM'd
      if (messaged[sender].blocked)   continue; // blocked user
      if (followed_up[sender])        continue; // already followed up — never double send

      console.log(`\n↩ Reply detected from u/${item.author.name}`);

      const valTpl  = getValueMsg();
      const linkTpl = getLinkMsg();

      try {
        // Step 2a — value, no link
        await reddit.composeMessage({
          to:      item.author.name,
          subject: "re: quick question",
          text:    valTpl.text
        });
        console.log(`✓ Step 2a → u/${item.author.name} | ${valTpl.id}`);

        await sentWriter.writeRecords([{
          time:       new Date().toISOString(),
          username:   item.author.name,
          step:       "STEP_2A",
          templateId: valTpl.id,
          subreddit:  messaged[sender].subreddit || "",
          leadType:   messaged[sender].leadType  || "",
          trigger:    messaged[sender].trigger   || "",
          url:        messaged[sender].url       || ""
        }]);

        // Wait 10–30s before link message
        const pause = FOLLOWUP_MIN_MS + Math.random() * (FOLLOWUP_MAX_MS - FOLLOWUP_MIN_MS);
        console.log(`  Pausing ${Math.round(pause/1000)}s before link...`);
        await sleep(pause);

        // Step 2b — link
        await reddit.composeMessage({
          to:      item.author.name,
          subject: "re: quick question",
          text:    linkTpl.text
        });
        console.log(`✓ Step 2b → u/${item.author.name} | ${linkTpl.id}`);

        await sentWriter.writeRecords([{
          time:       new Date().toISOString(),
          username:   item.author.name,
          step:       "STEP_2B",
          templateId: linkTpl.id,
          subreddit:  messaged[sender].subreddit || "",
          leadType:   messaged[sender].leadType  || "",
          trigger:    messaged[sender].trigger   || "",
          url:        messaged[sender].url       || ""
        }]);

        // Mark fully followed up — never fires again for this user
        followed_up[sender] = {
          at:       new Date().toISOString(),
          valueTpl: valTpl.id,
          linkTpl:  linkTpl.id
        };
        state.followed_up = followed_up;
        saveState(state);

      } catch (err) {
        console.log(`✗ Failed follow-up → u/${item.author.name}: ${err.message}`);
      }
    }

    // Mark all valid DMs as read so getUnreadMessages never returns them again
    if (toMarkRead.length > 0) {
      try {
        await reddit.markMessagesAsRead(toMarkRead);
        console.log(`  Marked ${toMarkRead.length} message(s) as read.`);
      } catch (err) {
        console.log(`  Warning: could not mark messages as read: ${err.message}`);
      }
    }

  } catch (err) {
    console.log(`Inbox check error: ${err.message}`);
  }
}

/* =========================
   MAIN
========================= */
(async () => {
  console.log("=".repeat(60));
  console.log("ClientMagnet — Dev Job Kit 2-Step Outreach");
  console.log("=".repeat(60));
  console.log(`Step 1 DMs per cycle:  ${MIN_DMS_PER_CYCLE}–${MAX_DMS_PER_CYCLE}`);
  console.log(`Delay between DMs:     ${MIN_DELAY_MS/60000}–${MAX_DELAY_MS/60000} min`);
  console.log(`Inbox poll interval:   ${INBOX_POLL_MS/1000}s`);
  console.log(`Follow-up split delay: ${FOLLOWUP_MIN_MS/1000}–${FOLLOWUP_MAX_MS/1000}s`);
  console.log("=".repeat(60));

  // Inbox monitor on its own interval — never blocks outreach loop
  setInterval(checkInboxAndFollowup, INBOX_POLL_MS);

  // Outreach loop
  while (true) {
    console.log(`\n[${new Date().toLocaleString()}] Starting outreach cycle...`);
    const state = loadState();
    await runOutreachCycle(state);

    const cycleDelay = (8 + Math.floor(Math.random() * 4)) * 60 * 1000;
    console.log(`Next cycle in ${Math.round(cycleDelay/60000)} minutes...`);
    await sleep(cycleDelay);
  }
})();
