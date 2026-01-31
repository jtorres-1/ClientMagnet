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
   SUBREDDITS - AUTOMATION/FREELANCE FOCUS
   
   PRIMARY TARGETS (business owners with pain):
   - Entrepreneur: Business automation needs
   - ecommerce: Inventory, order processing, data entry
   - SaaS: API integrations, workflow automation
   - startups: Early-stage manual processes
   - shopify: E-commerce merchants (high automation need)
   
   SECONDARY TARGETS (service seekers):
   - freelance: Freelancers looking for automation
   - smallbusiness: SMBs with repetitive tasks
   - digitalnomad: Remote workers optimizing workflows
========================= */
const subs = [
  // Primary business subs (highest ROI)
  "Entrepreneur",
  "ecommerce",
  "SaaS",
  "startups",
  "shopify",
  
  // Secondary service seekers
  "freelance",
  "smallbusiness",
  "digitalnomad"
];

/* =========================
   PIPELINE A — AUTOMATION PAIN (PRIMARY)
   
   High intent signals:
   - Complaining about manual tasks
   - Data entry frustration
   - Spreadsheet/Excel hell
   - Looking for automation solutions
   - Repetitive work complaints
========================= */
const automationPainRegex = /(manual data entry|spreadsheet hell|reporting sucks|need scraper|need a scraper|automate workflow|automate this|automate my|PDF invoice|inventory manual|manual inventory|lead gen manual|data cleanup pain|repetitive task|manual reporting|excel hell|copy paste|copy-paste|manual process|time consuming task|doing this manually|manually entering|waste of time|tedious task|hours of manual|repetitive work|automation solution|need automation|scraping data|extract data|data extraction|automate.*process|sick of manual|tired of manual|hate doing this|so much manual)/i;

/* =========================
   PIPELINE B — SCRAPER/BOT SEEKING (HIGH INTENT)
   
   Users explicitly asking for bots, scrapers, tools
========================= */
const toolSeekingRegex = /(need.*bot|build.*bot|need.*scraper|build.*scraper|automate.*bot|looking for.*bot|hire.*bot|bot.*automate|scraper.*data|api integration|workflow automation|zapier alternative|custom tool|automation tool|script to automate)/i;

/* =========================
   PIPELINE C — WORKFLOW COMPLAINTS (SECONDARY)
   
   General productivity/efficiency pain
========================= */
const workflowPainRegex = /(so inefficient|inefficient process|better way to|faster way to|streamline|optimize.*workflow|improve.*process|speed up.*process|reduce.*time|save.*time|productivity hack|efficiency)/i;

/* =========================
   CONTEXT VALIDATION
   
   Ensure it's about business/work tasks, not personal stuff
========================= */
const businessContextRegex = /(business|client|customer|order|invoice|inventory|sales|lead|data|report|spreadsheet|excel|csv|api|workflow|process|task|project|CRM|ecommerce|shopify|store|product|SKU)/i;

/* =========================
   HARD BLOCKS
   
   Exclude:
   - Sellers/service providers (competitors)
   - Job postings
   - Memes/jokes
   - Personal tasks (not business)
   - Questions about hiring employees
========================= */
const sellerRegex = /(i can help|i offer|my service|hire me|freelancer available|developer for hire|dm me|telegram|discord|portfolio|check out my|\$\d+\/hr|pay me)/i;
const jobPostingRegex = /(hiring|job opening|we're looking for|seeking developer|full-time|part-time|remote position|apply here|send resume)/i;
const memeRegex = /(🔥|💀|😂|lmao|lmfao|bruh|💯|🐐)/;
const personalRegex = /(my girlfriend|my boyfriend|my wife|my husband|my mom|my dad|my family|personal project|hobby|for fun)(?!.*(business|client|customer))/i;

/* =========================
   FRESH POSTS ONLY
   
   72 hours (business pain is less time-sensitive than betting)
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

  // Minimum quality
  if (title.length < 15) return null;
  
  // Hard blocks
  if (sellerRegex.test(combined)) return null;
  if (jobPostingRegex.test(combined)) return null;
  if (memeRegex.test(title)) return null;
  if (personalRegex.test(combined)) return null;

  // Must have business context
  if (!businessContextRegex.test(combined)) return null;

  /* ---------- AUTOMATION PAIN PIPELINE ---------- */
  const hasAutomationPain = automationPainRegex.test(combined);
  
  if (hasAutomationPain) {
    const matched = combined.match(automationPainRegex)?.[0] || "manual task";

    return {
      type: "AUTOMATION_PAIN",
      trigger: matched
    };
  }

  /* ---------- TOOL SEEKING PIPELINE ---------- */
  const isToolSeeking = toolSeekingRegex.test(combined);

  if (isToolSeeking) {
    const matched = combined.match(toolSeekingRegex)?.[0] || "automation";

    return {
      type: "TOOL_SEEKING",
      trigger: matched
    };
  }

  /* ---------- WORKFLOW PAIN PIPELINE ---------- */
  const hasWorkflowPain = 
    workflowPainRegex.test(combined) &&
    businessContextRegex.test(combined);

  if (hasWorkflowPain) {
    const matched = combined.match(workflowPainRegex)?.[0] || "inefficient";

    return {
      type: "WORKFLOW_PAIN",
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
  console.log("Starting Client Magnet scraper (Automation Services - Freelance Lead Gen)…");

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
