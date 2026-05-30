require("dotenv").config();
const fs = require("fs");
const path = require("path");
const snoowrap = require("snoowrap");

const reddit = new snoowrap({
  userAgent: process.env.REDDIT_USER_AGENT,
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
});

const baseDir = path.resolve(__dirname, "logs");
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir);
const leadsPath = path.join(baseDir, "clean_leads.csv");
const HEADER = "username,title,url,subreddit,time,leadType,matchedTrigger,product";
if (!fs.existsSync(leadsPath)) fs.writeFileSync(leadsPath, HEADER + "\n");

function prependLead(file, rowObj) {
  const row = Object.values(rowObj).join(",") + "\n";
  const lines = fs.readFileSync(file, "utf8").split("\n");
  if (!lines[0].startsWith("username")) lines.unshift(HEADER);
  lines.splice(1, 0, row.trim());
  fs.writeFileSync(file, lines.join("\n"));
}

// Hyper-targeted subs where people are ACTIVELY looking for leads right now
const BUSINESS_SUBS = [
  // Direct lead buyers
  "sales", "b2bsales", "coldemail", "coldcalling", "leadgeneration",
  "salestechniques", "salesforce", "salestips",
  // Agencies and freelancers who need leads constantly
  "agency", "marketing", "digital_marketing", "freelance", "freelancing",
  "PPC", "bigseo", "SEO", "socialmediamarketing",
  // Real estate -- obsessed with leads
  "RealEstate", "realtors", "realestateinvesting", "WholesaleRealestate",
  "FirstTimeHomeBuyer", "CommercialRealEstate",
  // Insurance -- always prospecting
  "Insurance", "LifeInsurance", "InsuranceAgent",
  // High ticket services
  "financialplanning", "FinancialAdvisors", "mortgagebroker",
  // Entrepreneurs and small biz
  "Entrepreneur", "smallbusiness", "startups", "ecommerce",
  "dropship", "AmazonSeller",
  // Solar and home services -- huge lead buyers
  "solar", "HVAC", "Plumbing", "homeowners", "roofing",
  // Side hustlers and outreach folks
  "sidehustle", "passive_income", "Flipping", "hustle"
];

// Strong buying intent -- these people NEED leads now
const highIntentRegex = /\b(need leads|need more leads|where (do i|can i) (find|get) leads|how (do i|to) get (more )?(leads|clients|customers)|looking for leads|finding leads|lead source|buy leads|purchase leads|lead list|lead database|list of (businesses|contacts|clients)|build a list|prospect list|contact list|where to find (businesses|clients|customers|prospects)|how to find (businesses|clients|customers|prospects)|outreach list|cold list|email list of|phone list|scraping (leads|businesses|contacts)|data for outreach|getting clients|acquire clients|find (local |new |more )?(clients|customers|businesses)|generate leads|lead generation (tool|software|service)|Apollo|ZoomInfo|Hunter\.io|Lusha|Seamless|lead gen tool)\b/i;

// Secondary intent -- pain points that lead to buying
const mediumIntentRegex = /\b(struggling to get clients|can't find clients|hard to find customers|need more business|grow my (business|agency|practice)|scale my (business|agency)|client acquisition|new clients|outreach strategy|cold outreach|prospecting strategy|building a pipeline|sales pipeline|door to door|canvassing|local business owners|target local|local (market|marketing|outreach))\b/i;

const ownerRegex = /\b(my (business|agency|company|firm|practice)|i (run|own|operate|manage)|we (run|own|operate)|owner|founder|operator|freelancer|consultant|sales rep|account exec|business development|bdr|sdr|marketer|realtor|agent|broker|rep)\b/i;

const blockRegex = /\b(looking for a job|job hunting|resume|cover letter|applying for|interview prep|laid off|unemployment|homework|assignment|school project|research paper|how do i become|how to become)\b/i;
const spamRegex = /\b(check out my|buy now|limited offer|discount code|promo code|affiliate link|click here|dm me for)\b/i;

function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 72; // 72 hours to cast wider net
}

function classify(post) {
  const title = (post.title || "").toLowerCase();
  const body = (post.selftext || "").toLowerCase();
  const combined = `${title} ${body}`;
  if (title.length < 10) return null;
  if (blockRegex.test(combined)) return null;
  if (spamRegex.test(combined)) return null;

  const highIntent = highIntentRegex.test(combined);
  const medIntent = mediumIntentRegex.test(combined);
  if (!highIntent && !medIntent) return null;

  const triggerMatch = (combined.match(highIntentRegex) || combined.match(mediumIntentRegex))?.[0] || "leads";
  const isOwner = ownerRegex.test(combined);

  let type;
  if (highIntent && isOwner) type = "HIGH_INTENT_OWNER";
  else if (highIntent) type = "HIGH_INTENT";
  else if (isOwner) type = "MEDIUM_INTENT_OWNER";
  else type = "MEDIUM_INTENT";

  return { type, trigger: triggerMatch, product: "MAPZAP" };
}

const wait = ms => new Promise(res => setTimeout(res, ms));

async function scrapeSubreddits(subs) {
  const existingUrls = new Set(
    fs.readFileSync(leadsPath, "utf8").split("\n").map(l => l.split(",")[2])
  );
  let leads = 0;
  for (const sub of subs) {
    console.log(`Scanning r/${sub}`);
    try {
      await wait(1000);
      const posts = await reddit.getSubreddit(sub).getNew({ limit: 100 });
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
          matchedTrigger: result.trigger,
          product: result.product
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
  return leads;
}

async function scrape() {
  console.log("=".repeat(50));
  console.log("ClientMagnet -- MapZap Scraper");
  console.log("=".repeat(50));
  const leads = await scrapeSubreddits(BUSINESS_SUBS);
  console.log(`Scrape complete -- leads found: ${leads}`);
}

(async () => {
  while (true) {
    await scrape();
    await wait(20 * 60 * 1000);
  }
})();
