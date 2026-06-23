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
const HEADER = "username,title,url,subreddit,time,leadType,matchedTrigger,product,budget,score";
if (!fs.existsSync(leadsPath)) fs.writeFileSync(leadsPath, HEADER + "\n");

function prependLead(file, rowObj) {
  const row = Object.values(rowObj).map(v => `${v}`).join(",") + "\n";
  const lines = fs.readFileSync(file, "utf8").split("\n");
  if (!lines[0].startsWith("username")) lines.unshift(HEADER);
  lines.splice(1, 0, row.trim());
  fs.writeFileSync(file, lines.join("\n"));
}

// ─── DEVHIRE SUBREDDITS ───────────────────────────────────────────────────────
const DEVHIRE_SUBREDDITS = [
  "forhire",
  "slavelabour",
  "DoneDirtCheap",
  "learnmachinelearning",
  "hwstartups",
  "EntrepreneurRideAlong",
  "SomebodyMakeThis",
  "startups",
  "JobsForGeeks",
  "WorkOnline",
  "jobs4bitcoins",
  "FreelanceWebDevelopers",
  "hireai",
  "Entrepreneur",
  "smallbusiness",
  "agency",
  "digital_marketing",
  "ecommerce",
];

// ─── LOCKEDIN QUERIES ─────────────────────────────────────────────────────────
const LOCKEDIN_QUERIES = [
  "I waste so much time figuring out what to do first",
  "I can't stick to a schedule",
  "I have too many tasks and don't know where to start",
  "I spend my whole morning planning and never get anything done",
  "I'm so unproductive I don't know why",
  "I struggle to manage my time",
  "I can't get anything done during the day",
  "how do I stop wasting my mornings",
  "I have no structure to my day",
  "I need help organizing my day",
  "I feel overwhelmed with everything I need to do",
  "I can never finish my to do list",
  "my days feel chaotic and unproductive",
  "I need to be more productive but don't know how",
  "I procrastinate all day and get nothing done",
  "I have ADHD and can't organize my tasks",
  "I struggle with time blocking",
  "I can never follow through with my schedule",
  "I need a better morning routine",
  "how to actually be productive",
  "I set goals but never follow through",
  "I feel like I'm always busy but getting nothing done",
  "I need to plan my day better",
  "how to stop wasting time every morning",
  "I lose hours just deciding what to work on",
];

// ─── BLOCK FILTERS ────────────────────────────────────────────────────────────
// Block anyone OFFERING services — tags only, not "for hire" phrase which buyers also use
const offeringTagRegex = /^\s*\[(for hire|FH|FOR HIRE|offering|OFFERING|available|AVAILABLE|forhire)\]/i;

const offeringContentRegex = /\b(i am available|i('m| am) a (developer|designer|programmer|dev|coder|engineer|freelancer)|offering my services|available for hire|hire me|my rates|i build websites|i develop websites|i create websites|check out my work|starting at \$|my portfolio|years of experience|i have experience|i specialize in|my skills include|i can build|i can develop|i can create|i can help you build|dm me if you need|feel free to dm|looking for (clients|projects|work|opportunities)|open to (work|projects|clients)|taking on (clients|projects)|accepting (clients|projects)|available for (projects|work|freelance)|i do (freelance|contract)|contract developer|remote developer|senior developer|junior developer|full stack developer available|react developer available|python developer available|nodejs developer available|i offer my|my services include|my work includes|portfolio link)\b/i;

const blockRegex = /\b(looking for a job|job hunting|resume|cover letter|applying for|interview prep|laid off|unemployment|homework|assignment|school project|research paper|how do i become|how to become|learning to code|trying to learn|beginner developer|new to programming|studying programming)\b/i;

// ─── HIRING TAG DETECTION ─────────────────────────────────────────────────────
// Matches buyer posts: [H], [Hiring], [HIRING], [Hire], [hire], [PAID], [Budget], [Job], [Project]
const hiringTagRegex = /^\s*\[(h|hiring|hire|paid|budget|job|project|HIRING|HIRE|H|PAID|BUDGET|JOB|PROJECT)\]/i;

const hiringKeywordRegex = /\b(looking to hire|want to hire|need to hire|hiring a|hiring an|need a developer|need a programmer|need a coder|need a dev|need someone to build|need someone to create|need someone to code|need someone to fix|need someone to scrape|need someone to automate|looking for a developer|looking for a programmer|looking for a coder|looking for a dev|budget is|my budget|willing to pay|will pay|paying|paid project|paid work|paid gig|fixed price|flat fee|one time project|short term project|contract work|freelance project|commission|bounty|need built|needs to be built|need to get done|need this done|can anyone build|can someone build|who can build|anyone able to build|anyone available to build|need help building|need help creating|need help coding|need help with my|need help fixing|i need to automate|i need to scrape|i need a bot|i need a script|i need a tool|i need a website|i need an app|i need a scraper|i need a dashboard|i need an api|i need a saas)\b/i;

// ─── BUDGET DETECTION ─────────────────────────────────────────────────────────
const budgetRegex = /\$\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(k|K)?|\b(\d+(?:,\d{3})*)\s*(dollars?|usd|budget)\b/i;
const urgencyRegex = /\b(urgent|urgently|asap|as soon as possible|today|immediately|right away|need it done fast|need it now|rush|quickly|by tomorrow|by end of day|eod)\b/i;

// ─── LOCKEDIN INTENT ──────────────────────────────────────────────────────────
const lockedInIntentRegex = /\b(waste (time|my morning|hours)|wasting (time|mornings)|can't (stick to|follow|organize|manage|get anything done|finish)|struggling (to|with) (manage|organize|plan|schedule|focus|time|productivity)|overwhelmed (with|by) (tasks|everything|to do)|no structure|chaotic day|unproductive|procrastinat|don't know where to start|too many tasks|can never finish|lose(s)? hours|morning routine|time blocking|plan my day|organize my day|better schedule|stop wasting|ADHD and (can't|struggle|unable)|nothing done|always busy but|getting nothing done)\b/i;

const firstPersonBuyerRegex = /\b(i need|i'm looking|i am looking|i want|i have a budget|i will pay|i need to hire|i'm hiring|i am hiring|i need help with|i need someone to|i'm searching|i am searching|how do i|how can i|does anyone know|can anyone|anyone know|we need|our (company|business|team) needs)\b/i;

// ─── FRESHNESS ────────────────────────────────────────────────────────────────
function isFresh(post, maxHours = 6) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= maxHours;
}

// ─── ACCOUNT QUALITY ─────────────────────────────────────────────────────────
function isQualityAccount(post) {
  const karma = (post.author?.comment_karma || 0) + (post.author?.link_karma || 0);
  const ageMs = Date.now() - ((post.author?.created_utc || 0) * 1000);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return karma >= 10 && ageDays >= 30;
}

// ─── BUDGET EXTRACTION ────────────────────────────────────────────────────────
function extractBudget(text) {
  const match = text.match(budgetRegex);
  if (!match) return null;
  return match[0].trim().slice(0, 20);
}

// ─── HIRING POST CHECK ────────────────────────────────────────────────────────
function isHiringPost(post) {
  const title = (post.title || "");
  const body = (post.selftext || "");
  const combined = `${title} ${body}`;

  // Block offering tags in title
  if (offeringTagRegex.test(title)) return false;
  // Block offering content
  if (offeringContentRegex.test(combined)) return false;
  if (blockRegex.test(combined)) return false;

  // Must have hiring tag OR hiring keywords
  const hasHiringTag = hiringTagRegex.test(title);
  const hasKeywords = hiringKeywordRegex.test(combined);

  return hasHiringTag || hasKeywords;
}

// ─── LOCKEDIN POST CHECK ──────────────────────────────────────────────────────
function isLockedInLead(post) {
  const title = (post.title || "").toLowerCase();
  const body = (post.selftext || "").toLowerCase();
  const combined = `${title} ${body}`;

  if (title.length < 10) return false;
  if (offeringTagRegex.test(title)) return false;
  if (offeringContentRegex.test(combined)) return false;
  if (blockRegex.test(combined)) return false;
  if (!lockedInIntentRegex.test(combined)) return false;
  if (!firstPersonBuyerRegex.test(combined)) return false;

  return true;
}

// ─── LEAD SCORING ─────────────────────────────────────────────────────────────
function scoreDevHireLead(post) {
  let score = 40; // base for subreddit hire posts
  const combined = `${post.title} ${post.selftext || ""}`.toLowerCase();

  if (budgetRegex.test(combined)) score += 20;
  if (urgencyRegex.test(combined)) score += 15;
  if (/bot|scraper|automation|automate|script|api|saas|dashboard|web app/.test(combined)) score += 10;
  if (/\$[5-9]\d{2}|\$[1-9]\d{3}/.test(combined)) score += 15; // $500+ budget
  if (/python|node|playwright|puppeteer|selenium|ai|openai|gpt/.test(combined)) score += 8;

  return score;
}

const wait = ms => new Promise(res => setTimeout(res, ms));

// ─── SCRAPE DEVHIRE SUBREDDITS ────────────────────────────────────────────────
async function scrapeDevHireSubreddits() {
  const existingUrls = new Set(
    fs.readFileSync(leadsPath, "utf8").split("\n").map(l => l.split(",")[2])
  );
  let leads = 0;

  for (const sub of DEVHIRE_SUBREDDITS) {
    console.log(`Scraping r/${sub} for hiring posts...`);
    try {
      await wait(2000);
      const posts = await reddit.getSubreddit(sub).getNew({ limit: 100 });
      for (const p of posts) {
        if (!p.author) continue;
        if (!isFresh(p, 6)) continue;
        if (!isHiringPost(p)) continue;
        if (!isQualityAccount(p)) continue;

        const url = `https://reddit.com${p.permalink}`;
        if (existingUrls.has(url)) continue;

        const combined = `${p.title} ${p.selftext || ""}`;
        const budget = extractBudget(combined) || "";
        const score = scoreDevHireLead(p);
        const isUrgent = urgencyRegex.test(combined);

        const row = {
          username: p.author.name,
          title: `"${p.title.replace(/"/g, "'").replace(/,/g, " ")}"`,
          url,
          subreddit: `r/${sub}`,
          time: new Date(p.created_utc * 1000).toISOString(),
          leadType: isUrgent ? "DEV_HIRE_URGENT" : "DEV_HIRE_SUBREDDIT",
          matchedTrigger: p.title.slice(0, 60).replace(/,/g, " "),
          product: "DEVHIRE",
          budget,
          score
        };
        prependLead(leadsPath, row);
        existingUrls.add(url);
        leads++;
        console.log(`  + ${row.leadType} [r/${sub}] score:${score} budget:${budget||"unknown"}: u/${p.author.name} - "${p.title.slice(0, 50)}"`);
      }
    } catch (err) {
      console.log(`Error scraping r/${sub}: ${err.message}`);
      await wait(10000);
    }
  }
  return leads;
}

// ─── SCRAPE LOCKEDIN GLOBAL SEARCH ────────────────────────────────────────────
async function scrapeLockedIn() {
  const existingUrls = new Set(
    fs.readFileSync(leadsPath, "utf8").split("\n").map(l => l.split(",")[2])
  );
  let leads = 0;

  for (const query of LOCKEDIN_QUERIES) {
    console.log(`Searching: "${query}" [LOCKEDIN]`);
    try {
      await wait(2000);
      const posts = await reddit.search({ query, sort: "new", time: "day", limit: 100 });
      for (const p of posts) {
        if (!p.author || !isFresh(p, 24)) continue;
        if (!isLockedInLead(p)) continue;
        if (!isQualityAccount(p)) continue;

        const url = `https://reddit.com${p.permalink}`;
        if (existingUrls.has(url)) continue;

        const triggerMatch = (p.title + " " + p.selftext).toLowerCase().match(lockedInIntentRegex)?.[0] || "unproductive";
        const row = {
          username: p.author.name,
          title: `"${p.title.replace(/"/g, "'").replace(/,/g, " ")}"`,
          url,
          subreddit: p.subreddit_name_prefixed || p.subreddit,
          time: new Date(p.created_utc * 1000).toISOString(),
          leadType: "LOCKEDIN_INTENT",
          matchedTrigger: triggerMatch,
          product: "LOCKEDIN",
          budget: "",
          score: 45
        };
        prependLead(leadsPath, row);
        existingUrls.add(url);
        leads++;
        console.log(`  + LOCKEDIN_INTENT: u/${p.author.name} - "${triggerMatch}"`);
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
  console.log("ClientMagnet -- Subreddit Hiring + lockedIn Search");
  console.log("=".repeat(50));
  let leads = 0;
  leads += await scrapeDevHireSubreddits();
  leads += await scrapeLockedIn();
  console.log(`Scrape complete -- leads found: ${leads}`);
}

(async () => {
  while (true) {
    await scrape();
    await wait(2 * 60 * 1000); // 2 min interval for speed
  }
})();
