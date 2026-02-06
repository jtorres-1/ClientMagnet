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
   SUBREDDITS - HVAC & BLUE COLLAR CONTRACTORS ONLY
========================= */
const subs = [
  "HVAC",
  "HVACR",
  "contractors",
  "Construction",
  "Trades",
  "Handyman",
  "smallbusiness"
];

/* =========================
   PRIMARY REQUIRED KEYWORDS
   
   At least ONE must be present or SKIP entirely
========================= */
const primaryKeywordRegex = /\b(hvac|hvacr|heating|cooling|air conditioning|ac repair|furnace|contractor|trades business|service company|home services)\b/i;

/* =========================
   PAIN SIGNAL FILTERS
   
   At least ONE pain signal must be present alongside primary keyword
========================= */
const painSignalRegex = /\b(leads?|calls?|scheduling|booking|dispatcher|missed calls?|marketing|growth|slow season|automation|answering phones?|customer intake|not enough work|need more clients?|phone system|lead gen|getting customers?|finding work|growing business|scale|overwhelmed|too busy|can't keep up|falling behind|booked out|wait time)\b/i;

/* =========================
   OWNER IDENTIFICATION SIGNALS
   
   Prefer users who speak like business owners
========================= */
const ownerSignalRegex = /\b(my business|my company|my shop|my crew|my team|my employees?|my techs?|my customers?|my clients?|hired|firing|payroll|we do|we handle|we service|i run|i own|i operate|our business|our company|running a|owning a|started my)\b/i;

/* =========================
   HARD BLOCKS - EXCLUDE THESE
   
   Students, job seekers, technicians asking career advice, vendors
========================= */
const studentRegex = /\b(student|studying|in school|hvac school|trade school|apprentice looking|how do i become|getting into hvac|starting out|first year|looking for a job|need a job|anyone hiring)\b/i;

const jobSeekerRegex = /\b(resume|cv|looking for work|need a job|job hunting|where to apply|hiring\?|anyone need|tech position|service tech opening|entry level|junior tech)\b/i;

const vendorRegex = /\b(i sell|we sell|our product|our software|our service|check out our|try our|we offer|book a demo|free trial|sign up|partner with us|affiliate|commission)\b/i;

const careerAdviceRegex = /\b(should i become|worth it to|is hvac a good|thinking about switching|career change|leave my job|better career|advice on becoming|get into the trade)\b/i;

/* =========================
   CONTEXT VALIDATION
   
   Must be discussing business operations, not personal home issues
========================= */
const businessContextRegex = /\b(business|company|shop|customers?|clients?|jobs?|service calls?|techs?|technicians?|employees?|crew|team|invoices?|estimates?|bids?|contracts?|revenue|profit|overhead|marketing|advertising|website|scheduling|dispatch|calls?|leads?|bookings?)\b/i;

const personalHomeRegex = /\b(my house|my home|my apartment|my condo|my unit|landlord|tenant|renting|homeowner|diy|doing it myself)\b/i;

/* =========================
   FRESH POSTS ONLY - 48 HOURS
========================= */
function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 48;
}

/* =========================
   CLASSIFIER - STRICT FILTERING
========================= */
function classify(post) {
  const title = (post.title || "").toLowerCase();
  const body = (post.selftext || "").toLowerCase();
  const combined = `${title} ${body}`;

  // Minimum quality
  if (title.length < 10) return null;
  
  /* ========== RULE 1: PRIMARY KEYWORD REQUIRED ========== */
  if (!primaryKeywordRegex.test(combined)) {
    return null; // SKIP - no primary keyword
  }

  /* ========== HARD BLOCKS ========== */
  if (studentRegex.test(combined)) return null;
  if (jobSeekerRegex.test(combined)) return null;
  if (vendorRegex.test(combined)) return null;
  if (careerAdviceRegex.test(combined)) return null;
  
  // Block personal home issues
  if (personalHomeRegex.test(combined) && !businessContextRegex.test(combined)) {
    return null;
  }

  /* ========== RULE 2: PAIN SIGNAL REQUIRED ========== */
  const hasPainSignal = painSignalRegex.test(combined);
  
  if (!hasPainSignal) {
    return null; // SKIP - has HVAC mention but no business pain
  }

  /* ========== RULE 3: BUSINESS CONTEXT REQUIRED ========== */
  if (!businessContextRegex.test(combined)) {
    return null; // SKIP - not clearly business-related
  }

  /* ========== CLASSIFICATION ========== */
  
  // Extract matched pain signal for context
  const painMatch = combined.match(painSignalRegex)?.[0] || "business pain";
  
  // Check if they're clearly an owner
  const hasOwnerSignal = ownerSignalRegex.test(combined);
  
  if (hasOwnerSignal) {
    return {
      type: "OWNER_WITH_PAIN",
      trigger: painMatch
    };
  }
  
  // Could be owner but less certain - still worth messaging if pain is clear
  return {
    type: "LIKELY_OWNER",
    trigger: painMatch
  };
}

const wait = ms => new Promise(res => setTimeout(res, ms));

/* =========================
   SCRAPER LOOP
========================= */
async function scrape() {
  console.log("Starting ClientMagnet scraper (HVAC & Blue Collar Contractors)…");

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
        
        // Log the match
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
   RUN LOOP
========================= */
(async () => {
  while (true) {
    await scrape();
    await wait(45 * 60 * 1000); // Run every 45 minutes
  }
})();
