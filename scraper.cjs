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
   SUBREDDITS — BUSINESS OWNER / FOUNDER TARGETS
========================= */
const subs = [
  "entrepreneur",
  "smallbusiness",
  "startups",
  "SaaS",
  "digital_marketing",
  "agency",
  "Entrepreneur",
  "freelance",
  "consulting",
  "marketing",
  "sales",
  "growmybusiness",
  "ecommerce",
  "Affiliatemarketing"
];

/* =========================
   PRIMARY KEYWORDS — BUSINESS / LEAD GEN CONTEXT
========================= */
const primaryKeywordRegex = /\b(leads|lead generation|lead gen|clients|customer acquisition|getting customers|getting clients|outreach|cold email|cold outreach|sales pipeline|pipeline|prospecting|booking calls|booked calls|closing deals|conversion|converting|inbound|outbound|marketing|advertising|growth|revenue|churn|retention|referrals|word of mouth|social media|content marketing|seo|paid ads|facebook ads|google ads)\b/i;

/* =========================
   PAIN SIGNALS — LEAD GEN / CLIENT ACQUISITION PAIN
========================= */
const painSignalRegex = /\b(no leads|no clients|can't get clients|can't get leads|struggling to get|not getting clients|not getting leads|slow month|slow sales|dead pipeline|no pipeline|no sales|revenue dropped|losing clients|losing customers|churn is high|nobody is buying|no one is buying|low conversion|low conversions|not converting|outreach isn't working|cold email not working|ads not working|wasting money on ads|burning through budget|no roi|terrible roi|tried everything|nothing is working|what am i doing wrong|how do i get more clients|how do i get more leads|how do i grow|struggling to grow|can't scale|can't grow|need more clients|need more leads|need more sales|desperate for clients|running out of money|runway is short|about to shut down|barely surviving|slow season|business is slow|not enough clients|not enough leads)\b/i;

/* =========================
   BUSINESS OWNER SIGNALS
========================= */
const businessOwnerRegex = /\b(my business|my company|my agency|my startup|my saas|my product|my service|i run|i own|i started|i founded|i built|we offer|we sell|our product|our service|our company|our agency|our startup|b2b|b2c|solopreneur|founder|co-founder|ceo|owner|operator)\b/i;

/* =========================
   HARD BLOCKS
========================= */
const jobSeekerRegex = /\b(looking for a job|job hunting|job search|need a job|resume|cover letter|applying for|interview prep|laid off|unemployment)\b/i;
const spamRegex = /\b(check out my|buy now|limited offer|discount code|promo code|affiliate link|click here)\b/i;

/* =========================
   FRESHNESS — 48 HOURS
========================= */
function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 48;
}

/* =========================
   CLASSIFIER
========================= */
function classify(post) {
  const title = (post.title || "").toLowerCase();
  const body = (post.selftext || "").toLowerCase();
  const combined = `${title} ${body}`;

  if (title.length < 10) return null;

  if (jobSeekerRegex.test(combined)) return null;
  if (spamRegex.test(combined)) return null;

  if (!primaryKeywordRegex.test(combined)) return null;
  if (!painSignalRegex.test(combined)) return null;

  const painMatch = combined.match(painSignalRegex)?.[0] || "getting clients";
  const hasOwnerSignal = businessOwnerRegex.test(combined);

  if (hasOwnerSignal) {
    return { type: "CONFIRMED_OWNER_PAIN", trigger: painMatch };
  }

  return { type: "GENERAL_BUSINESS_PAIN", trigger: painMatch };
}

const wait = ms => new Promise(res => setTimeout(res, ms));

/* =========================
   SCRAPER LOOP
========================= */
async function scrape() {
  console.log("Starting ClientMagnet scraper (Business Owner / Lead Gen Pain Targeting)...");

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
        console.log(`  + ${result.type}: u/${p.author.name} - "${result.trigger}"`);
      }

    } catch (err) {
      console.log(`Error r/${sub}: ${err.message}`);
      await wait(30000);
    }
  }

  console.log(`Scrape complete -- leads found: ${leads}`);
}

(async () => {
  while (true) {
    await scrape();
    await wait(30 * 60 * 1000);
  }
})();
