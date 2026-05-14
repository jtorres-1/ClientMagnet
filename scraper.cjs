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

// BOT SERVICE SUBREDDITS
const BOT_SERVICE_SUBS = [
  "entrepreneur", "smallbusiness", "startups", "SaaS",
  "digital_marketing", "agency", "Entrepreneur", "freelance",
  "consulting", "marketing", "sales", "growmybusiness",
  "ecommerce", "Affiliatemarketing"
];

// VOICE AGENT SUBREDDITS
const RESTAURANT_SUBS = [
  "restaurant", "restaurantowners", "KitchenConfidential",
  "bar", "foodservice", "bartenders", "Serverlife",
  "smallbusiness", "entrepreneur"
];

// BOT SERVICE PATTERNS
const botPrimaryRegex = /\b(leads|lead generation|lead gen|clients|customer acquisition|getting customers|getting clients|outreach|cold email|cold outreach|sales pipeline|pipeline|prospecting|booking calls|closing deals|conversion|inbound|outbound|marketing|advertising|growth|revenue|churn|referrals|social media|seo|paid ads|facebook ads|google ads)\b/i;
const botPainRegex = /\b(no leads|no clients|can't get clients|can't get leads|struggling to get|not getting clients|not getting leads|slow month|slow sales|dead pipeline|no pipeline|no sales|revenue dropped|losing clients|losing customers|nobody is buying|no one is buying|low conversion|not converting|outreach isn't working|cold email not working|ads not working|no roi|terrible roi|tried everything|nothing is working|what am i doing wrong|how do i get more clients|how do i get more leads|struggling to grow|can't scale|can't grow|need more clients|need more leads|need more sales|desperate for clients|running out of money|about to shut down|barely surviving|slow season|business is slow|not enough clients|not enough leads)\b/i;
const businessOwnerRegex = /\b(my business|my company|my agency|my startup|my saas|my product|my service|i run|i own|i started|i founded|i built|we offer|we sell|our product|our service|our company|our agency|b2b|b2c|solopreneur|founder|co-founder|ceo|owner|operator)\b/i;

// VOICE AGENT PATTERNS
const restaurantPrimaryRegex = /\b(phone|calls|reservations|booking|answering|receptionist|front of house|staffing|customers calling|missed calls|voicemail|phone system|call volume|busy signal|answer the phone|pickup|ring)\b/i;
const restaurantPainRegex = /\b(missing calls|missed calls|can't answer|can't get to the phone|phones ringing|overwhelmed|too busy to answer|no one answers|goes to voicemail|losing reservations|losing customers|phone always busy|staff too busy|short staffed|understaffed|can't hire|can't afford staff|phones are chaos|hate answering phones|phones are killing us|drowning in calls|need a receptionist|can't afford receptionist|after hours calls|calls go unanswered|reservation calls|takeout calls|call handling)\b/i;
const restaurantOwnerRegex = /\b(my restaurant|my bar|my cafe|my diner|my bistro|i own|i run|we run|we own|our restaurant|our bar|our place|our spot|our establishment|front of house|foh|chef|owner|operator|gm|general manager|hospitality|food service|fine dining|fast casual|qsr)\b/i;

// HARD BLOCKS
const jobSeekerRegex = /\b(looking for a job|job hunting|job search|need a job|resume|cover letter|applying for|interview prep|laid off|unemployment)\b/i;
const spamRegex = /\b(check out my|buy now|limited offer|discount code|promo code|affiliate link|click here)\b/i;

function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 48;
}

function classify(post, product) {
  const title = (post.title || "").toLowerCase();
  const body = (post.selftext || "").toLowerCase();
  const combined = `${title} ${body}`;

  if (title.length < 10) return null;
  if (jobSeekerRegex.test(combined)) return null;
  if (spamRegex.test(combined)) return null;

  if (product === "BOT_SERVICE") {
    if (!botPrimaryRegex.test(combined)) return null;
    if (!botPainRegex.test(combined)) return null;
    const painMatch = combined.match(botPainRegex)?.[0] || "getting clients";
    return {
      type: businessOwnerRegex.test(combined) ? "CONFIRMED_OWNER_PAIN" : "GENERAL_BUSINESS_PAIN",
      trigger: painMatch,
      product: "BOT_SERVICE"
    };
  }

  if (product === "VOICE_AGENT") {
    if (!restaurantPrimaryRegex.test(combined)) return null;
    if (!restaurantPainRegex.test(combined)) return null;
    const painMatch = combined.match(restaurantPainRegex)?.[0] || "missed calls";
    return {
      type: restaurantOwnerRegex.test(combined) ? "CONFIRMED_RESTAURANT_OWNER" : "GENERAL_RESTAURANT_PAIN",
      trigger: painMatch,
      product: "VOICE_AGENT"
    };
  }

  return null;
}

const wait = ms => new Promise(res => setTimeout(res, ms));

async function scrapeSubreddits(subs, product) {
  const existingUrls = new Set(
    fs.readFileSync(leadsPath, "utf8").split("\n").map(l => l.split(",")[2])
  );

  let leads = 0;

  for (const sub of subs) {
    console.log(`[${product}] Scanning r/${sub}`);
    try {
      await wait(1200);
      const posts = await reddit.getSubreddit(sub).getNew({ limit: 75 });

      for (const p of posts) {
        if (!p.author || !isFresh(p)) continue;
        const result = classify(p, product);
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
        console.log(`  + [${product}] ${result.type}: u/${p.author.name} - "${result.trigger}"`);
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
  console.log("ClientMagnet Dual Scraper -- Bot Service + Voice Agent");
  console.log("=".repeat(50));

  const botLeads = await scrapeSubreddits(BOT_SERVICE_SUBS, "BOT_SERVICE");
  const voiceLeads = await scrapeSubreddits(RESTAURANT_SUBS, "VOICE_AGENT");

  console.log(`Scrape complete -- Bot leads: ${botLeads} | Voice agent leads: ${voiceLeads}`);
}

(async () => {
  while (true) {
    await scrape();
    await wait(30 * 60 * 1000);
  }
})();
