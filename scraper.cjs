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

// First-person anchored queries — only buyers talking about their own needs
const DEVHIRE_QUERIES = [
  "I need a website for my business",
  "I need someone to build my website",
  "I need a website built",
  "I'm looking for a developer",
  "I am looking for a developer",
  "I need to hire a developer",
  "I'm hiring a developer",
  "I need an app built for my business",
  "I need a developer for my project",
  "I need a freelancer to build",
  "I will pay for a website",
  "I have a budget for a website",
  "I have a budget for a developer",
  "I need a web developer urgently",
  "I need a developer asap",
  "I need someone to build my app",
  "I need a chatbot for my business",
  "I need automation for my business",
  "I need a bot built",
  "I need a scraper built",
  "I need AI integration for my business",
  "I need a landing page built",
  "I need a shopify store built",
  "I need a wordpress site built",
  "I need a mobile app built",
  "I need a python developer",
  "I need a full stack developer",
  "I'm looking to hire a freelancer",
  "I need tech help for my business",
  "I need coding help",
];

const MAPZAP_QUERIES = [
  "I need leads for my business",
  "I need more clients for my business",
  "I need local business leads",
  "I need a lead list",
  "how do I find leads for my business",
  "I'm struggling to find clients",
  "I need more customers for my business",
  "I need business leads",
  "how do I get more clients",
  "I need to find more customers",
  "I need prospects for my business",
  "I need to generate leads",
];

const forHireBlockRegex = /\b(\[for hire\]|\[offering\]|i am available|i('m| am) a (developer|designer|programmer|dev)|offering my services|available for hire|hire me|my portfolio|my rates|my services|i build|i develop|i create|i code|i design|check out my work|starting at \$|flat fee)\b/i;
const blockRegex = /\b(looking for a job|job hunting|resume|cover letter|applying for|interview prep|laid off|unemployment|homework|assignment|school project|research paper|how do i become|how to become)\b/i;
const spamRegex = /\b(check out my|buy now|limited offer|discount code|promo code|affiliate link)\b/i;

const highIntentRegex = /\b(need leads|need more leads|where (do i|can i) (find|get) leads|how (do i|to) get (more )?(leads|clients|customers)|looking for leads|finding leads|lead source|buy leads|purchase leads|lead list|lead database|list of (businesses|contacts|clients)|build a list|prospect list|contact list|where to find (businesses|clients|customers|prospects)|how to find (businesses|clients|customers|prospects)|outreach list|cold list|email list of|phone list|scraping (leads|businesses|contacts)|data for outreach|getting clients|acquire clients|find (local |new |more )?(clients|customers|businesses)|generate leads|lead generation (tool|software|service))\b/i;

const mediumIntentRegex = /\b(struggling to get clients|can't find clients|hard to find customers|need more business|grow my (business|agency|practice)|scale my (business|agency)|client acquisition|new clients|outreach strategy|cold outreach|prospecting strategy|building a pipeline|sales pipeline)\b/i;

const ownerRegex = /\b(my (business|agency|company|firm|practice)|i (run|own|operate|manage)|we (run|own|operate)|owner|founder|operator|freelancer|consultant|sales rep|marketer|realtor|agent|broker)\b/i;

const devHireRegex = /\b(looking for (a |an )?(developer|dev|programmer|coder|python|engineer|freelancer)|hiring (a |an )?(developer|dev|programmer|coder|python|engineer)|need (a |an )?(developer|dev|programmer|coder|python dev|engineer|freelancer|someone to build|someone who can build)|want (a |an )?(developer|dev|programmer)|searching for (a |an )?(developer|dev|programmer)|anyone (available|able to|can) (build|create|develop|code|make)|budget (\$|usd)|willing to pay|will pay|paid (project|work|gig|opportunity)|paying for|bounty|paid job|contract (work|developer|position)|short term (project|contract)|one time (project|build)|need (this |it )?(built|coded|developed|created|made)|anyone (here )?build|can someone build|who can build|looking to (hire|commission))\b/i;

// First person buyer signals — must be present for DEVHIRE leads
const firstPersonBuyerRegex = /\b(i need|i'm looking|i am looking|i want|i have a budget|i will pay|i need to hire|i'm hiring|i am hiring|i need help with|i need someone to|i'm searching|i am searching|how do i|how can i)\b/i;

function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 72;
}

function classify(post, forceProduct) {
  const title = (post.title || "").toLowerCase();
  const body = (post.selftext || "").toLowerCase();
  const combined = `${title} ${body}`;
  if (title.length < 10) return null;
  if (blockRegex.test(combined)) return null;
  if (spamRegex.test(combined)) return null;
  if (forHireBlockRegex.test(combined)) return null;

  if (forceProduct === "DEVHIRE") {
    const devHire = devHireRegex.test(combined);
    if (!devHire) return null;
    // Must contain first person buyer language
    const isFirstPerson = firstPersonBuyerRegex.test(combined);
    if (!isFirstPerson) return null;
    const triggerMatch = combined.match(devHireRegex)?.[0] || "hiring";
    return { type: "DEV_HIRE", trigger: triggerMatch, product: "DEVHIRE" };
  }

  if (forceProduct === "MAPZAP") {
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

  return null;
}

const wait = ms => new Promise(res => setTimeout(res, ms));

async function searchGlobal(queries, product) {
  const existingUrls = new Set(
    fs.readFileSync(leadsPath, "utf8").split("\n").map(l => l.split(",")[2])
  );
  let leads = 0;

  for (const query of queries) {
    console.log(`Searching: "${query}" [${product}]`);
    try {
      await wait(2000);
      const posts = await reddit.search({
        query,
        sort: "new",
        time: "week",
        limit: 100,
      });

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
          subreddit: p.subreddit_name_prefixed || p.subreddit,
          time: new Date(p.created_utc * 1000).toISOString(),
          leadType: result.type,
          matchedTrigger: result.trigger,
          product: result.product
        };
        prependLead(leadsPath, row);
        existingUrls.add(url);
        leads++;
        console.log(`  + ${result.type} [${result.product}]: u/${p.author.name} - "${result.trigger}"`);
      }
    } catch (err) {
      console.log(`Error searching "${query}": ${err.message}`);
      await wait(15000);
    }
  }
  return leads;
}

async function scrape() {
  console.log("=".repeat(50));
  console.log("ClientMagnet -- Global Reddit Search");
  console.log("=".repeat(50));
  let leads = 0;
  leads += await searchGlobal(DEVHIRE_QUERIES, "DEVHIRE");
  leads += await searchGlobal(MAPZAP_QUERIES, "MAPZAP");
  console.log(`Scrape complete -- leads found: ${leads}`);
}

(async () => {
  while (true) {
    await scrape();
    await wait(20 * 60 * 1000);
  }
})();
