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

// ─── DEVHIRE QUERIES ─────────────────────────────────────────────────────────
const DEVHIRE_QUERIES = [
  "I need a booking bot built",
  "I need a bot built",
  "I need a scraper built",
  "I need automation built",
  "I need someone to automate",
  "I need a custom bot",
  "looking for bot developer",
  "my bot stopped working",
  "bot not working after update",
  "I need automation fixed",
  "need someone to fix my automation",
  "bot broke after update",
  "scraper stopped working",
  "I need a Puppeteer script",
  "I need web scraping done",
  "I need API automation",
  "I need a Discord bot built",
  "I need a Telegram bot built",
  "I need a Chrome extension built",
  "I need someone to build a tool",
  "I need API integration built",
  "I need an AI tool built",
  "I need a web app built",
  "I need a SaaS built",
  "I need a dashboard built",
  "I need someone to build my MVP",
  "I need to hire a developer",
  "I need a developer for my project",
  "I need a freelancer to build",
  "I need a web developer urgently",
  "I need a developer asap",
  "I need a developer this week",
  "I need someone to code",
  "I need a python developer",
  "I need a full stack developer",
  "I need a React developer",
  "I need someone to fix my website",
  "I need an app built for my business",
  "I need a chatbot for my business",
  "I need a landing page built",
  "I need a mobile app built",
  "I need a database built",
];

// ─── FLOWMATE QUERIES ─────────────────────────────────────────────────────────
const FLOWMATE_QUERIES = [
  "I keep losing leads because I respond too slow",
  "I forget to follow up with leads",
  "I need to follow up with leads faster",
  "my business is too slow to respond to leads",
  "I miss leads because I'm busy on the job",
  "I need automatic lead follow up",
  "I lose customers because I don't respond fast enough",
  "I need to text leads automatically",
  "how do I respond to leads faster",
  "I need a system to follow up with leads",
  "my leads go cold because I don't respond in time",
  "I need an automated follow up system",
  "I keep forgetting to text back leads",
  "I need to automate my lead follow up",
  "contractor losing leads to slow response",
  "plumber losing leads to slow response",
  "HVAC company losing leads",
  "I respond to leads too late",
  "need GoHighLevel alternative",
  "GoHighLevel too expensive",
  "I need instant lead response",
  "how to never miss a lead again",
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
const forHireBlockRegex = /\b(\[for hire\]|\[offering\]|\[available\]|i am available|i('m| am) a (developer|designer|programmer|dev|coder|engineer|freelancer)|offering my services|available for hire|hire me|my rates|i build websites|i develop websites|i create websites|i code for|check out my work|starting at \$|portfolio|years of experience|i have experience|i specialize in|my skills include|i can build|i can develop|i can create|i can help you build|dm me if you need|feel free to dm|looking for (clients|projects|work|opportunities)|open to (work|projects|clients)|taking on (clients|projects)|accepting (clients|projects)|available for (projects|work|freelance)|i do (freelance|contract)|contract developer|remote developer|senior developer|junior developer|full stack developer available|react developer available|python developer available)\b/i;

const blockRegex = /\b(looking for a job|job hunting|resume|cover letter|applying for|interview prep|laid off|unemployment|homework|assignment|school project|research paper|how do i become|how to become|learning to code|trying to learn|beginner developer|new to programming|studying programming)\b/i;

const spamRegex = /\b(buy now|limited offer|discount code|promo code|affiliate link)\b/i;

// ─── INTENT REGEXES ──────────────────────────────────────────────────────────
const devHireRegex = /\b(looking for (a |an )?(developer|dev|programmer|coder|engineer|freelancer|bot developer|automation developer)|hiring (a |an )?(developer|dev|programmer|coder|engineer|freelancer)|need (a |an )?(developer|dev|programmer|coder|engineer|freelancer|website|web developer|app|mobile app|chatbot|bot|scraper|landing page|tool|dashboard|saas|database|chrome extension|discord bot|telegram bot|api integration|ai integration|ai tool|mvp|automation|web app)|need (someone|anyone) to (build|create|develop|code|make|fix|automate|scrape)|want (a |an )?(developer|dev|programmer|website|app|bot|scraper|automation)|searching for (a |an )?(developer|dev|programmer|bot developer)|anyone (available|able to|can) (build|create|develop|code|make|fix|automate)|budget (\$|usd)|willing to pay|will pay|paid (project|work|gig|opportunity)|paying for|bounty|paid job|contract (work|developer|position)|short term (project|contract)|one time (project|build)|need (this |it )?(built|coded|developed|created|made|fixed|automated|scraped)|anyone (here )?build|can someone build|who can build|looking to (hire|commission)|need a (bot|scraper|tool|dashboard|app|site|website|extension|integration|api|mvp|saas|automation) (built|fixed|created|developed)|broken bot|bot broke|bot stopped working|automation broke|automation stopped working|scraper broke|scraper stopped working|fix my bot|fix my script|fix my automation|fix my scraper)\b/i;

const firstPersonBuyerRegex = /\b(i need|i'm looking|i am looking|i want|i have a budget|i will pay|i need to hire|i'm hiring|i am hiring|i need help with|i need someone to|i'm searching|i am searching|how do i|how can i|does anyone know|can anyone|anyone know|we need|our (company|business|team) needs)\b/i;

const flowMateIntentRegex = /\b(lose(s)? leads|losing leads|leads (go|going) cold|respond(ing)? (too )?(slow|late)|slow to respond|follow up (with leads|faster|automatically)|forget to (follow up|text back)|miss(ing)? leads|automatic(ally)? (text|respond|follow up)|instant lead response|never miss a lead|GoHighLevel|automated follow up|lead response (time|speed))\b/i;

const lockedInIntentRegex = /\b(waste (time|my morning|hours)|wasting (time|mornings)|can't (stick to|follow|organize|manage|get anything done|finish)|struggling (to|with) (manage|organize|plan|schedule|focus|time|productivity)|overwhelmed (with|by) (tasks|everything|to do)|no structure|chaotic day|unproductive|procrastinat|don't know where to start|too many tasks|can never finish|feel (busy|like i'm spinning)|lose(s)? hours|morning routine|time blocking|plan my day|organize my day|better schedule|stop wasting|ADHD and (can't|struggle|unable)|nothing done|always busy but|getting nothing done)\b/i;

const botAutomationSpecificRegex = /\b(bot|scraper|automation|automated|automate|booking bot|telegram bot|discord bot|puppeteer|selenium|web scraping|api automation|workflow automation|zapier|make\.com|n8n|broken script|fix my script|my script|my bot|my automation|my scraper)\b/i;

function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 24;
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
    if (!devHireRegex.test(combined)) return null;
    if (!firstPersonBuyerRegex.test(combined)) return null;
    if (/\bi (am|'m) (a |an )?(developer|dev|programmer|coder|engineer|freelancer)\b/i.test(combined)) return null;
    if (/\bi (build|develop|create|code|design) (websites|apps|bots|tools|automations)\b/i.test(combined)) return null;
    const triggerMatch = combined.match(devHireRegex)?.[0] || "hiring";
    const isBotSpecific = botAutomationSpecificRegex.test(combined);
    const leadType = isBotSpecific ? "DEV_HIRE_BOT" : "DEV_HIRE_GENERAL";
    return { type: leadType, trigger: triggerMatch, product: "DEVHIRE" };
  }

  if (forceProduct === "FLOWMATE") {
    if (!flowMateIntentRegex.test(combined)) return null;
    const isFirstPerson = firstPersonBuyerRegex.test(combined);
    if (!isFirstPerson) return null;
    const triggerMatch = combined.match(flowMateIntentRegex)?.[0] || "slow follow up";
    return { type: "FLOWMATE_INTENT", trigger: triggerMatch, product: "FLOWMATE" };
  }

  if (forceProduct === "LOCKEDIN") {
    if (!lockedInIntentRegex.test(combined)) return null;
    if (!firstPersonBuyerRegex.test(combined)) return null;
    const triggerMatch = combined.match(lockedInIntentRegex)?.[0] || "unproductive";
    return { type: "LOCKEDIN_INTENT", trigger: triggerMatch, product: "LOCKEDIN" };
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
        time: "day",
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
  leads += await searchGlobal(FLOWMATE_QUERIES, "FLOWMATE");
  leads += await searchGlobal(LOCKEDIN_QUERIES, "LOCKEDIN");
  console.log(`Scrape complete -- leads found: ${leads}`);
}

(async () => {
  while (true) {
    await scrape();
    await wait(5 * 60 * 1000);
  }
})();
