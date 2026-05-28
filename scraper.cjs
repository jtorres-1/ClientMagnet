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

// ALL BUSINESS SUBREDDITS -- MAXIMUM COVERAGE
const BUSINESS_SUBS = [
  // Food & Hospitality
  "smallbusiness", "restaurantowners", "restaurant", "AskARestaurantOwner",
  "barowners", "coffeeshops", "FoodTruck",
  // Professional Services
  "Entrepreneur", "legaladvice", "Accounting", "Insurance", "RealEstate", "realtors",
  "PropertyManagement", "mortgage",
  // Health & Wellness
  "Dentistry", "medical", "chiropractic", "physicaltherapy", "personaltraining",
  "Fitness", "massage", "optometry",
  // Beauty & Grooming
  "beauty", "Barbershop", "tattoo", "MedSpa",
  // Auto & Home
  "AutoMechanic", "MechanicAdvice", "Plumbing", "HVAC", "electricians", "handyman",
  "landscaping", "homeowners", "FlipThis",
  // Retail & Services
  "retail", "ecommerce", "eventplanning", "photography", "tutoring",
  "veterinary", "petbusiness", "airbnb",
  // General Business
  "marketing", "Flipping", "sidehustle", "passive_income"
];

// ANY POST MENTIONING PHONES/CALLS/BOOKINGS
const businessPrimaryRegex = /\b(phone|calls|booking|scheduling|appointments|receptionist|answering service|missed calls|voicemail|leads|customers calling|inquiries|client calls|front desk|after hours|call handling|callback|ring|ringing)\b/i;

const businessOwnerRegex = /\b(my business|my shop|my salon|my restaurant|my practice|my firm|my office|my clinic|my studio|my company|i own|i run|we run|we own|owner|operator|self employed|sole prop|small business owner|entrepreneur|running a business|manage a business|our business|our shop|our office)\b/i;

// HARD BLOCKS
const jobSeekerRegex = /\b(looking for a job|job hunting|job search|need a job|resume|cover letter|applying for|interview prep|laid off|unemployment|apprentice|trying to get into|how do i become|how to become a)\b/i;
const spamRegex = /\b(check out my|buy now|limited offer|discount code|promo code|affiliate link|click here)\b/i;

function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 48;
}

function classify(post) {
  const title = (post.title || "").toLowerCase();
  const body = (post.selftext || "").toLowerCase();
  const combined = `${title} ${body}`;
  if (title.length < 10) return null;
  if (jobSeekerRegex.test(combined)) return null;
  if (spamRegex.test(combined)) return null;
  if (!businessPrimaryRegex.test(combined)) return null;
  const triggerMatch = combined.match(businessPrimaryRegex)?.[0] || "calls";
  return {
    type: businessOwnerRegex.test(combined) ? "CONFIRMED_BUSINESS_OWNER" : "GENERAL_BUSINESS_PAIN",
    trigger: triggerMatch,
    product: "VOICE_AGENT"
  };
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
  console.log("ClientMagnet Business Scraper -- CallDone AI Receptionist");
  console.log("=".repeat(50));
  const leads = await scrapeSubreddits(BUSINESS_SUBS);
  console.log(`Scrape complete -- Business leads found: ${leads}`);
}

(async () => {
  while (true) {
    await scrape();
    await wait(20 * 60 * 1000);
  }
})();
