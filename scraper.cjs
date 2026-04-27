require("dotenv").config();
const fs = require("fs");
const path = require("path");
const snoowrap = require("snoowrap");

/* =========================
   REDDIT CLIENT
========================= */
const reddit = new snoowrap({
  userAgent: process.env.REDDIT_USER_AGENT,
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
});

/* =========================
   PATHS
========================= */
const baseDir = path.resolve(__dirname, "logs");
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir);

const leadsPath = path.join(baseDir, "clean_leads.csv");
const HEADER = "username,title,url,subreddit,time,leadType,matchedTrigger";

if (!fs.existsSync(leadsPath)) {
  fs.writeFileSync(leadsPath, HEADER + "\n");
}

function prependLead(file, rowObj) {
  const row = Object.values(rowObj).join(",") + "\n";
  const lines = fs.readFileSync(file, "utf8").split("\n");
  if (!lines[0].startsWith("username")) lines.unshift(HEADER);
  lines.splice(1, 0, row.trim());
  fs.writeFileSync(file, lines.join("\n"));
}

/* =========================
   SUBREDDITS — DEV JOB KIT TARGETS

   Job hunting, resume help, career advice,
   developer job search, recruiting pain
========================= */
const subs = [
  "cscareerquestions",
  "devops",
  "learnprogramming",
  "ExperiencedDevs",
  "webdev",
  "jobs",
  "resumes",
  "recruitinghell",
  "jobsearchhacks",
  "careerguidance",
  "programming",
  "softwareengineering",
  "techjobs"
];

/* =========================
   PRIMARY KEYWORDS — DEV JOB HUNT CONTEXT

   Must match active job searching activity.
   Categories:
   - Job hunt activity: applying, applications, job search, job hunting
   - Resume: resume, cv, bullet points, ATS, tailoring
   - Responses: callbacks, interviews, responses, ghosted, rejected
   - Cover letter: cover letter, writing, application materials
   - Platforms: linkedin, indeed, greenhouse, lever, workday
========================= */
const primaryKeywordRegex = /\b(applying|applied|application|applications|job search|job hunting|job hunt|resume|cv|cover letter|bullet points|ats|tailoring|tailor|callbacks|callback|interview|interviews|response|responses|ghosted|rejected|rejection|linkedin|indeed|greenhouse|lever|workday|hiring|recruiter|recruiters|job posting|job description)\b/i;

/* =========================
   PAIN SIGNALS — DEV JOB KIT SPECIFIC

   Targets frustration, lack of responses,
   resume confusion, application volume with no results
========================= */
const painSignalRegex = /\b(no callbacks|no response|no responses|no interviews|not hearing back|getting ghosted|been ghosted|applied to \d+|applied to over|applied to hundreds|hundreds of applications|mass applying|spray and pray|rejection after rejection|rejection emails|generic resume|same resume|not tailoring|don't know how to tailor|how do i tailor|ats friendly|beating ats|ats rejected|resume not working|resume isn't working|resume feels|cover letter help|don't know what to write|hate writing cover letters|cover letter is generic|why am i not getting|why aren't i getting|months of applying|been applying for|out of work|laid off|got laid off|job hunting for months|no luck|running out of|desperate|nothing is working|what am i doing wrong|should i give up|feeling hopeless|feeling defeated|burnout|exhausted from applying)\b/i;

/* =========================
   JOB SEEKER SIGNALS (BONUS — NOT REQUIRED)

   Confirms the poster is actively job hunting
========================= */
const jobSeekerSignalRegex = /\b(i applied|i've applied|i have applied|i'm applying|i am applying|my resume|my cv|my cover letter|sent out|sending out|been applying|applying for months|job hunting|on the market|open to work|currently looking|actively looking|need a job|need work|between jobs|unemployed|laid off)\b/i;

/* =========================
   HARD BLOCKS — SKIP THESE
========================= */
const vendorRegex = /\b(we sell|our product|our software|check out our|try our|book a demo|free trial|discount code|affiliate|promo code)\b/i;
const hiringRegex = /\b(we are hiring|we're hiring|our team is hiring|join our team|open position|job opening|now hiring)\b/i;
const studentOnlyRegex = /\b(thinking about becoming a developer|how do i get into|career change advice|should i learn to code|is coding worth it)\b/i;

/* =========================
   FRESHNESS — 48 HOURS

   Job posts go stale fast — tighter window than car flipping
========================= */
function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 48;
}

/* =========================
   CLASSIFIER — DEV JOB KIT TARGETING

   Requires: primary keyword + pain signal
   Bonus: job seeker signal upgrades lead type
========================= */
function classify(post) {
  const title = (post.title || "").toLowerCase();
  const body = (post.selftext || "").toLowerCase();
  const combined = `${title} ${body}`;

  // Minimum quality
  if (title.length < 10) return null;

  /* ========== HARD BLOCKS FIRST ========== */
  if (vendorRegex.test(combined)) return null;
  if (hiringRegex.test(combined)) return null;
  if (studentOnlyRegex.test(combined)) return null;

  /* ========== RULE 1: MUST BE JOB HUNT RELATED ========== */
  if (!primaryKeywordRegex.test(combined)) return null;

  /* ========== RULE 2: MUST HAVE PAIN SIGNAL ========== */
  const hasPainSignal = painSignalRegex.test(combined);
  if (!hasPainSignal) return null;

  // Extract matched pain signal for DM context
  const painMatch = combined.match(painSignalRegex)?.[0] || "the job search";

  /* ========== CLASSIFICATION ========== */
  const hasJobSeekerSignal = jobSeekerSignalRegex.test(combined);

  if (hasJobSeekerSignal) {
    return {
      type: "ACTIVE_SEEKER_PAIN",    // Confirmed job seeker with a pain point
      trigger: painMatch
    };
  }

  return {
    type: "GENERAL_JOB_PAIN",        // Likely job seeker, pain present
    trigger: painMatch
  };
}

const wait = ms => new Promise(res => setTimeout(res, ms));

/* =========================
   SCRAPER LOOP
========================= */
async function scrape() {
  console.log("Starting Dev Job Kit scraper (Job Hunt / Resume Pain Targeting)...");

  const existingUrls = new Set(
    fs.readFileSync(leadsPath, "utf8")
      .split("\n")
      .map(l => l.split(",")[2])
  );

  let leads = 0;

  for (const sub of subs) {
    console.log(`Scanning r/${sub}`);
    try {
      await wait(1200);
      const posts = await reddit.getSubreddit(sub).getNew({ limit: 75 });

      for (const p of posts) {
        if (!p.author || !isFresh(p)) continue;

        const result = classify(p);
        if (!result) continue;

        const url = `https://reddit.com${p.permalink}`;
        if (existingUrls.has(url)) continue;

        const row = {
          username: p.author.name,
          title: `"${p.title.replace(/"/g, "'")}"`,
          url,
          subreddit: sub,
          time: new Date(p.created_utc * 1000).toISOString(),
          leadType: result.type,
          matchedTrigger: result.trigger
        };

        prependLead(leadsPath, row);
        existingUrls.add(url);
        leads++;
        console.log(`  ✓ ${result.type}: u/${p.author.name} - "${result.trigger}"`);
      }

    } catch (err) {
      console.log(`Error r/${sub}: ${err.message}`);
      await wait(30000);
    }
  }

  console.log(`Scrape complete — leads found: ${leads}`);
}

/* =========================
   RUN LOOP — UNCHANGED FROM ORIGINAL
========================= */
(async () => {
  while (true) {
    await scrape();
    await wait(30 * 60 * 1000); // Every 30 minutes
  }
})();
