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

// ─── DEVHIRE SUBREDDITS ───────────────────────────────────────────────────────
// Only scrape subreddits where every post is a buyer looking to hire
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
  "webdev",
  "Python",
  "javascript",
  "node",
  "reactjs",
  "programming",
  "softwaregore",
  "hireai",
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
// Anyone offering services — not buying
const offeringBlockRegex = /\b(\[for hire\]|\[FOR HIRE\]|\[offering\]|\[OFFERING\]|\[available\]|\[AVAILABLE\]|for hire|FOR HIRE|i am available|i('m| am) a (developer|designer|programmer|dev|coder|engineer|freelancer)|offering my services|available for hire|hire me|my rates|i build websites|i develop websites|i create websites|check out my work|starting at \$|my portfolio|years of experience|i have experience|i specialize in|my skills include|i can build|i can develop|i can create|i can help you build|dm me if you need|feel free to dm|looking for (clients|projects|work|opportunities)|open to (work|projects|clients)|taking on (clients|projects)|accepting (clients|projects)|available for (projects|work|freelance)|i do (freelance|contract)|contract developer|remote developer|senior developer|junior developer|full stack developer available|react developer available|python developer available|nodejs developer available|i offer|my services|my work|my experience|portfolio link|github\.com\/(?!jtorres))\b/i;

const blockRegex = /\b(looking for a job|job hunting|resume|cover letter|applying for|interview prep|laid off|unemployment|homework|assignment|school project|research paper|how do i become|how to become|learning to code|trying to learn|beginner developer|new to programming|studying programming)\b/i;

// Must have hiring intent tags or keywords
const hiringTagRegex = /^\s*\[h\]|\[hiring\]|\[hire\]|\[paid\]|\[budget\]|\[job\]|\[project\]/i;

const hiringKeywordRegex = /\b(looking to hire|want to hire|need to hire|hiring a|hiring an|need a developer|need a programmer|need a coder|need a dev|need someone to build|need someone to create|need someone to code|need someone to fix|need someone to scrape|need someone to automate|looking for a developer|looking for a programmer|looking for a coder|looking for a dev|budget is|my budget|willing to pay|will pay|paying|paid project|paid work|paid gig|fixed price|flat fee|one time project|short term project|contract work|freelance project|commission|bounty|need built|get built|have built|needs to be built|need to get done|need this done|can anyone build|can someone build|who can build|anyone able to build|anyone available to build|need help building|need help creating|need help coding|need help with my|need help fixing)\b/i;

// ─── LOCKEDIN INTENT ──────────────────────────────────────────────────────────
const lockedInIntentRegex = /\b(waste (time|my morning|hours)|wasting (time|mornings)|can't (stick to|follow|organize|manage|get anything done|finish)|struggling (to|with) (manage|organize|plan|schedule|focus|time|productivity)|overwhelmed (with|by) (tasks|everything|to do)|no structure|chaotic day|unproductive|procrastinat|don't know where to start|too many tasks|can never finish|feel (busy|like i'm spinning)|lose(s)? hours|morning routine|time blocking|plan my day|organize my day|better schedule|stop wasting|ADHD and (can't|struggle|unable)|nothing done|always busy but|getting nothing done)\b/i;

const firstPersonBuyerRegex = /\b(i need|i'm looking|i am looking|i want|i have a budget|i will pay|i need to hire|i'm hiring|i am hiring|i need help with|i need someone to|i'm searching|i am searching|how do i|how can i|does anyone know|can anyone|anyone know|we need|our (company|business|team) needs)\b/i;

function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 24;
}

function isHiringPost(post) {
  const title = (post.title || "");
  const body = (post.selftext || "");
  const combined = `${title} ${body}`;

  // Block anyone offering services
  if (offeringBlockRegex.test(combined)) return false;
  if (blockRegex.test(combined)) return false;

  // Must have hiring tag in title OR hiring keywords in body
  const hasTag = hiringTagRegex.test(title);
  const hasKeywords = hiringKeywordRegex.test(combined);

  return hasTag || hasKeywords;
}

function isLockedInLead(post) {
  const title = (post.title || "").toLowerCase();
  const body = (post.selftext || "").toLowerCase();
  const combined = `${title} ${body}`;

  if (title.length < 10) return false;
  if (offeringBlockRegex.test(combined)) return false;
  if (blockRegex.test(combined)) return false;
  if (!lockedInIntentRegex.test(combined)) return false;
  if (!firstPersonBuyerRegex.test(combined)) return false;

  return true;
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
        if (!p.author || !isFresh(p)) continue;
        if (!isHiringPost(p)) continue;

        const url = `https://reddit.com${p.permalink}`;
        if (existingUrls.has(url)) continue;

        const row = {
          username: p.author.name,
          title: `"${p.title.replace(/"/g, "'")}"`,
          url,
          subreddit: `r/${sub}`,
          time: new Date(p.created_utc * 1000).toISOString(),
          leadType: "DEV_HIRE_SUBREDDIT",
          matchedTrigger: p.title.slice(0, 60),
          product: "DEVHIRE"
        };
        prependLead(leadsPath, row);
        existingUrls.add(url);
        leads++;
        console.log(`  + DEV_HIRE_SUBREDDIT [r/${sub}]: u/${p.author.name} - "${p.title.slice(0, 60)}"`);
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
        if (!p.author || !isFresh(p)) continue;
        if (!isLockedInLead(p)) continue;

        const url = `https://reddit.com${p.permalink}`;
        if (existingUrls.has(url)) continue;

        const triggerMatch = (p.title + " " + p.selftext).toLowerCase().match(lockedInIntentRegex)?.[0] || "unproductive";
        const row = {
          username: p.author.name,
          title: `"${p.title.replace(/"/g, "'")}"`,
          url,
          subreddit: p.subreddit_name_prefixed || p.subreddit,
          time: new Date(p.created_utc * 1000).toISOString(),
          leadType: "LOCKEDIN_INTENT",
          matchedTrigger: triggerMatch,
          product: "LOCKEDIN"
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
    await wait(5 * 60 * 1000);
  }
})();
