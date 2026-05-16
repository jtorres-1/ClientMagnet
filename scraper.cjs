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

// CONTRACTOR / SERVICE BUSINESS SUBREDDITS
const CONTRACTOR_SUBS = [
  "Plumbing", "HVAC", "electricians", "Construction", "Roofing",
  "Contractor", "homeimprovement", "landscaping", "lawncare",
  "smallbusiness", "Entrepreneur", "Flooring", "handyman",
  "pestcontrol", "GarageDoors", "Locksmith", "AskElectricians",
  "AskPlumbing", "AskContractors"
];

// CONTRACTOR / SERVICE BUSINESS PATTERNS
const contractorPrimaryRegex = /\b(phone|calls|booking|scheduling|dispatch|appointments|receptionist|answering service|missed calls|voicemail|leads|customers calling|service calls|estimates|quotes|jobs|jobsite|on a job|in the field)\b/i;
const contractorPainRegex = /\b(missing calls|missed calls|can't answer|can't get to the phone|on a job|in someone's house|under a sink|on a roof|in an attic|in a crawl space|phones ringing|too busy|drowning in calls|no time to call back|losing jobs|losing customers|losing leads|can't hire|can't afford a receptionist|need a receptionist|answering service is terrible|too expensive|after hours calls|emergency calls|calls go unanswered|voicemail full|missed leads|missed estimates|missing money|missing work|forgot to call back|never called them back|callback)\b/i;
const contractorOwnerRegex = /\b(my plumbing|my hvac|my electrical|my roofing|my contracting|my construction|my landscaping|my company|my crew|my truck|my shop|i own|i run|we run|we own|owner operator|owner|operator|self employed|sole prop|licensed|journeyman|master plumber|master electrician|gc|general contractor|tradesman|in the trades|field tech|service tech)\b/i;

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

  if (!contractorPrimaryRegex.test(combined)) return null;
  if (!contractorPainRegex.test(combined)) return null;
  const painMatch = combined.match(contractorPainRegex)?.[0] || "missed calls";
  return {
    type: contractorOwnerRegex.test(combined) ? "CONFIRMED_CONTRACTOR_OWNER" : "GENERAL_CONTRACTOR_PAIN",
    trigger: painMatch,
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
  console.log("ClientMagnet Contractor Scraper -- CallDone Voice Agent");
  console.log("=".repeat(50));

  const leads = await scrapeSubreddits(CONTRACTOR_SUBS);

  console.log(`Scrape complete -- Contractor leads found: ${leads}`);
}

(async () => {
  while (true) {
    await scrape();
    await wait(30 * 60 * 1000);
  }
})();
