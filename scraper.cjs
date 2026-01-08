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
   SUBREDDITS (HIGH ROI)
========================= */
const subs = [
  // SaaS / founders
  "SaaS",
  "startups",
  "SideProject",
  "EntrepreneurRideAlong",

  // Agencies / builders
  "agency",
  "automation",
  "nocode",

  // Local practice owners
  "dentistry",
  "medicalpractice",
  "privatepractice",
  "healthcare",
  "smallbusiness",

  // Tool pain (high ROI)
  "stripe",
  "emailmarketing",
  "marketingautomation",
  "zapier",

  // Hiring (secondary)
  "forhire",
  "jobbit"
];


/* =========================
   PIPELINE A — HIRING (SECONDARY)
========================= */
const hiringRegex = /(hiring|looking for|need a developer|developer needed|seeking developer|need someone to build|who can build)/i;
const moneyRegex = /(paid|budget|rate|paying|compensation|usd|\$)/i;

/* =========================
   PIPELINE B — PAIN (PRIMARY)
========================= */
const painRegex = /(how do i|is there a way|still doing|manually|any tool for|struggling with|pain point|workflow issue|not scaling|takes too long|inefficient|error|not working)/i;

const painTechRegex = /(stripe|email|emails|automation|backend|auth|login|csv|spreadsheet|google sheets|database|supabase|webhook|crm|follow[- ]?up|onboarding|subscription)/i;

/* =========================
   DEV / BUSINESS CONTEXT
========================= */
const devContextRegex = /(app|software|saas|client|customer|users|business|company|agency|startup|store|practice|clinic|office)/i;

/* =========================
   HARD BLOCKS
========================= */
const sellerRegex = /(i am a developer|hire me|my services|portfolio|available for work|\[offer\])/i;
const hardExcludeRegex = /(vtuber|minecraft|roblox|gaming|youtube channel|logo design|graphic design|instagram growth|social media growth)/i;

/* =========================
   FRESH POSTS ONLY
========================= */
function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 72;
}

/* =========================
   CLASSIFIER
========================= */
function classify(post) {
  const title = (post.title || "").toLowerCase();
  const body = (post.selftext || "").toLowerCase();
  const combined = `${title} ${body}`;

  if (title.length < 10) return null;
  if (sellerRegex.test(combined)) return null;
  if (hardExcludeRegex.test(combined)) return null;

  /* ---------- HIRING PIPELINE ---------- */
  if (hiringRegex.test(title) && moneyRegex.test(combined)) {
    return {
      type: "HIRING",
      trigger: "HIRING + MONEY"
    };
  }

  /* ---------- PAIN PIPELINE ---------- */
  const painMatch =
    painRegex.test(combined) &&
    painTechRegex.test(combined) &&
    devContextRegex.test(combined);

  if (painMatch) {
    const matched =
      combined.match(painTechRegex)?.[0] ||
      combined.match(painRegex)?.[0] ||
      "pain";

    return {
      type: "PAIN",
      trigger: matched
    };
  }

  return null;
}

const wait = ms => new Promise(res => setTimeout(res, ms));

/* =========================
   SCRAPER LOOP
========================= */
async function scrape() {
  console.log("Starting Client Magnet scraper (PAIN primary, HIRING secondary)…");

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
    await wait(45 * 60 * 1000);
  }
})();
