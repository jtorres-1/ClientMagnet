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
   SUBREDDITS - SERVICE-BASED TRADES ONLY
   
   Focused on businesses that need call/lead automation
========================= */
const subs = [
  "HVAC",
  "Plumbing",
  "electricians",
  "Handyman",
  "Roofing",
  "landscaping",
  "contractors",
  "smallbusiness"
];

/* =========================
   PRIMARY KEYWORDS - ALL SERVICE TRADES
   
   Expanded to catch all phone-based service businesses
   
   Categories:
   - HVAC: hvac, heating, cooling, air conditioning, furnace, ac
   - Plumbing: plumb, plumber, plumbing, pipe, drain, leak, sewer, water heater
   - Electrical: electric, electrician, electrical, wire, wiring, panel, breaker, outlet, generator
   - Roofing: roof, roofing, roofer, shingle, gutter, leak
   - Landscaping: landscape, landscaping, lawn, mowing, yard, irrigation, tree service
   - General: contractor, handyman, home service, service business, trade
========================= */
const primaryKeywordRegex = /\b(hvac|heating|cooling|air conditioning|a\/c|ac|furnace|heat pump|plumb|plumber|plumbing|pipe|drain|leak|sewer|water heater|septic|electric|electrician|electrical|wire|wiring|panel|breaker|outlet|generator|roof|roofing|roofer|shingle|gutter|landscape|landscaping|landscaper|lawn|mowing|yard|irrigation|tree service|contractor|contracting|handyman|home service|service business|service company|trade business|trades)\b/i;

/* =========================
   PAIN SIGNALS (EXPANDED)
   
   More variety to catch different ways people express pain
========================= */
const painSignalRegex = /\b(lead|leads|call|calls|phone|schedule|scheduling|book|booking|appointments?|dispatcher|dispatch|miss|missed|marketing|advertis|seo|google|facebook|website|growth|grow|scale|scaling|busy|slow|season|dead|quiet|automat|software|crm|tool|app|answer|intake|customers?|clients?|jobs?|work|projects?|business|revenue|sales|profit|money|income|struggling|difficult|hard|challenge|problem|issue|help|advice|recommend|suggest|better way|improve|streamline|efficien|time|hours|waste|overwhelm|stress|burnout)\b/i;

/* =========================
   BUSINESS OWNER SIGNALS (OPTIONAL BOOST)
   
   If present, scores higher, but not required
========================= */
const ownerSignalRegex = /\b(my business|my company|my shop|my crew|my team|my employees?|my techs?|my customers?|my clients?|we do|we service|we install|we repair|i run|i own|i operate|i started|our business|our company)\b/i;

/* =========================
   HARD BLOCKS - SKIP THESE
========================= */
const studentRegex = /\b(student|studying|in school|trade school|apprentice program|how do i become|getting into|career change to|thinking about becoming)\b/i;

const jobSeekerRegex = /\b(resume|cv|looking for work|need a job|job hunt|where to apply|anyone hiring|apply|application)\b/i;

const vendorRegex = /\b(we sell|our product|our software|check out our|try our|book a demo|free trial|discount code|affiliate)\b/i;

/* =========================
   FRESH POSTS - 72 HOURS
   
   Extended from 48 to catch more
========================= */
function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 72;
}

/* =========================
   CLASSIFIER - BALANCED FILTERING
   
   CHANGED: Only requires primary keyword + pain signal
   Business context is IMPLIED if both exist
========================= */
function classify(post) {
  const title = (post.title || "").toLowerCase();
  const body = (post.selftext || "").toLowerCase();
  const combined = `${title} ${body}`;

  // Minimum quality
  if (title.length < 10) return null;
  
  /* ========== HARD BLOCKS FIRST ========== */
  if (studentRegex.test(combined)) return null;
  if (jobSeekerRegex.test(combined)) return null;
  if (vendorRegex.test(combined)) return null;
  
  /* ========== RULE 1: PRIMARY KEYWORD REQUIRED ========== */
  if (!primaryKeywordRegex.test(combined)) {
    return null; // SKIP - not service trade related
  }

  /* ========== RULE 2: PAIN SIGNAL REQUIRED ========== */
  const hasPainSignal = painSignalRegex.test(combined);
  
  if (!hasPainSignal) {
    return null; // SKIP - no business pain mentioned
  }

  /* ========== CLASSIFICATION ========== */
  
  // Extract matched pain signal
  const painMatch = combined.match(painSignalRegex)?.[0] || "business challenge";
  
  // Check if they're clearly an owner (bonus, not required)
  const hasOwnerSignal = ownerSignalRegex.test(combined);
  
  if (hasOwnerSignal) {
    return {
      type: "OWNER_WITH_PAIN",
      trigger: painMatch
    };
  }
  
  // Default: likely relevant even without explicit owner signals
  return {
    type: "CONTRACTOR_PAIN",
    trigger: painMatch
  };
}

const wait = ms => new Promise(res => setTimeout(res, ms));

/* =========================
   SCRAPER LOOP
========================= */
async function scrape() {
  console.log("Starting ClientMagnet scraper (Service-Based Trades)…");

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
   RUN LOOP - AGGRESSIVE MODE
========================= */
(async () => {
  while (true) {
    await scrape();
    await wait(30 * 60 * 1000); // Run every 30 minutes
  }
})();
