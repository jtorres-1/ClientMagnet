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
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

const BANNED_PATH = path.join(baseDir, "banned_subs.json");
const COMMENTED_PATH = path.join(baseDir, "commented_posts.json");

const CYCLE_INTERVAL_MS = 10 * 60 * 1000;
const MIN_DELAY_MS = 2 * 60 * 1000;
const MAX_DELAY_MS = 4 * 60 * 1000;
const MAX_COMMENTS_PER_CYCLE = 25;

const DEVHIRE_QUERIES = [
  "looking for a developer",
  "looking for a web developer",
  "looking for a python developer",
  "looking to hire a developer",
  "want to hire a developer",
  "need to hire a developer",
  "need a developer for my",
  "need a dev for my",
  "need someone to build my website",
  "need someone to build my app",
  "need someone to build my",
  "need help building my website",
  "need help building my app",
  "need a website for my business",
  "need a website built",
  "need my website built",
  "need an app built",
  "need a bot built",
  "need a scraper built",
  "need automation built",
  "need a chatbot built",
  "need a landing page built",
  "need a shopify developer",
  "need a wordpress developer",
  "need a python developer",
  "need a react developer",
  "need a full stack developer",
  "need a freelance developer",
  "need a freelance dev",
  "need a mvp built",
  "need a saas built",
  "need a developer this week",
  "need a developer asap",
  "where can I find a developer",
  "recommend a developer",
];

const MAPZAP_QUERIES = [
  "need more leads for my business",
  "need local business leads",
  "need a lead list",
  "need more clients for my business",
  "need more customers for my business",
  "need prospects for my business",
  "need to generate leads for my",
  "how do I find leads for my business",
  "how to get more clients for my",
  "struggling to find clients",
  "struggling to get leads",
  "where to find business leads",
  "how to build a prospect list",
  "need outreach list",
  "need cold outreach list",
  "need more sales for my business",
  "need more clients for my agency",
  "how to grow my agency clients",
  "need b2b leads",
];

const BLOCK_SUBS = [
  "autisticwithadhd","autism","adhd","mentalhealth","depression","anxiety",
  "relationship_advice","relationships","amitheasshole","tifu","askreddit",
  "gopro","gaming","politics","news","worldnews","funny","pics","videos",
  "science","technology","history","books","movies","music","sports",
  "fitness","loseit","food","cooking","travel","personalfinance",
  "legaladvice","medical","health","parenting","teenagers",
  "mildlyinteresting","oddlysatisfying","todayilearned",
  "graphicdesignjobs","paidonlinejobs","remotejobs","jobseekers",
  "careerguidance","resumes","sidehustlesindia","sidehustlepaglu",
  "bangalorestartups","startupindia","startupfuture","newgentechnology",
  "switch","switch2","nintendo","playstation","xbox","steam","pcgaming",
  "hardware","buildapc","apple","android","iphone","samsung",
  "webdesign","uxdesign","tiktok","instagram","twitter","youtube",
  "wallstreetbets","investing","stocks","cryptocurrency","bitcoin",
  "ethereum","nft","defi","web3","crypto","blockchain",
  "freelancedesigners","freelancewriters","hireawriter","hireadesigner",
  "programmers_forhire","youtubeeditorsforhire","imsuccessconnection",
  "darts","website_ideas","freelanceindia","shareailprompts","shareaiprompts",
  "deadlock","deadlockcoaching","gaming","leagueoflegends","valorant",
  "csgo","cs2","fortnite","minecraft","roblox","apexlegends",
];

const FOR_HIRE_BLOCK = [
  "[for hire]","[offering]","for hire","available for hire","hire me",
  "my services","my rates","my portfolio","i am available","i'm available",
  "anyone need a website","anyone need a developer","anyone need a dev",
  "i build websites","i build apps","i build bots","i make websites",
  "i can build","offering my","offering web","offering dev",
  "i am a developer","i am a dev","i'm a developer","i'm a dev",
  "looking for clients","looking for projects","looking for work",
  "taking on clients","open for work","available for work",
  "review:","i used it","my results","30 days","i tested",
];

const DEVHIRE_COMMENTS = [
  `python dev in LA here — i build websites, scrapers, automation bots, and AI integrations. flat fee, 48 hour delivery. recent work: [mapzap.org](https://mapzap.org) and [claudiascleaningla.com](https://claudiascleaningla.com). DM me a scope`,
  `i can help with this. python developer in LA, available now. websites, scrapers, bots, AI integrations. flat fee only, 48hr delivery. built [mapzap.org](https://mapzap.org) and [claudiascleaningla.com](https://claudiascleaningla.com). DM me what you need`,
  `python dev available this week. i build websites, automation bots, scrapers, AI integrations. flat fee, 48 hour turnaround. DM me a scope`,
  `this is exactly what i do. python and node.js developer in LA. websites, scrapers, bots, AI integrations, 48hr delivery, flat fee. $500 websites, $800 automation. DM me`,
  `available for this. python dev, LA based. built live production tools including a google maps SaaS and automation pipelines. flat fee, 48hr delivery. DM me what you need built`,
];

const MAPZAP_COMMENTS = [
  `this might help — built [mapzap.org](https://mapzap.org), pulls 100 local business leads from Google Maps in 60 seconds as a CSV. name, phone, address, website. $49/month unlimited searches, free preview no card needed`,
  `built something for exactly this — [mapzap.org](https://mapzap.org) scrapes 100 local businesses from Google Maps in 60 seconds. type a niche and city, get a CSV instantly. $49/month unlimited, free preview available`,
  `[mapzap.org](https://mapzap.org) might solve this. pulls 100 local business leads in 60 seconds from Google Maps. CSV with name, phone, address, website. $49/month unlimited searches, free to try first`,
  `i built a tool for this — [mapzap.org](https://mapzap.org). type any business type and city, get 100 leads as a CSV in 60 seconds. $49/month unlimited, no card needed for preview`,
  `built [mapzap.org](https://mapzap.org) for this exact problem. 100 local business leads from Google Maps in 60 seconds as a downloadable CSV. $49/month unlimited searches, free preview available`,
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function log(tag, msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`);
}

function loadBanned() {
  if (!fs.existsSync(BANNED_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(BANNED_PATH)); } catch { return []; }
}

function loadCommented() {
  if (!fs.existsSync(COMMENTED_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(COMMENTED_PATH)); } catch { return {}; }
}

function saveCommented(commented) {
  fs.writeFileSync(COMMENTED_PATH, JSON.stringify(commented, null, 2));
}

function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 24;
}

const wait = ms => new Promise(res => setTimeout(res, ms));

async function runCycle() {
  const banned = loadBanned();
  const commented = loadCommented();
  let commentsThisCycle = 0;

  const allQueries = [
    ...DEVHIRE_QUERIES.map(q => ({ query: q, type: "DEVHIRE" })),
    ...MAPZAP_QUERIES.map(q => ({ query: q, type: "MAPZAP" })),
  ];

  // Target subs directly — no global search noise
  const SUB_TARGETS = [
    { sub: "forhire", type: "DEVHIRE" },
    { sub: "slavelabour", type: "DEVHIRE" },
    { sub: "jobbit", type: "DEVHIRE" },
    { sub: "WorkOnline", type: "DEVHIRE" },
    { sub: "freelance_forhire", type: "DEVHIRE" },
    { sub: "PythonJobs", type: "DEVHIRE" },
    { sub: "webdevjobs", type: "DEVHIRE" },
    { sub: "hireadev", type: "DEVHIRE" },
    { sub: "Jobs4Bitcoins", type: "DEVHIRE" },
    { sub: "RemoteWork", type: "DEVHIRE" },
    { sub: "digitalnomad", type: "DEVHIRE" },
    { sub: "freelancing", type: "DEVHIRE" },
    { sub: "agency", type: "MAPZAP" },
    { sub: "cold_email", type: "MAPZAP" },
    { sub: "coldemail", type: "MAPZAP" },
    { sub: "leadgeneration", type: "MAPZAP" },
    { sub: "sales", type: "MAPZAP" },
    { sub: "smallbusiness", type: "MAPZAP" },
    { sub: "Entrepreneur", type: "MAPZAP" },
    { sub: "EntrepreneurRideAlong", type: "MAPZAP" },
    { sub: "sweatystartup", type: "MAPZAP" },
    { sub: "growmybusiness", type: "MAPZAP" },
    { sub: "digital_marketing", type: "MAPZAP" },
    { sub: "marketing", type: "MAPZAP" },
    { sub: "realtors", type: "MAPZAP" },
    { sub: "InsuranceAgents", type: "MAPZAP" },
    { sub: "msp", type: "MAPZAP" },
  ];

  SUB_TARGETS.sort(() => Math.random() - 0.5);

  for (const { sub, type } of SUB_TARGETS) {
    if (commentsThisCycle >= MAX_COMMENTS_PER_CYCLE) {
      log("INFO", `Hit max comments. Stopping.`);
      break;
    }

    // Skip if banned
    if (banned.some(b => b.toLowerCase() === sub.toLowerCase())) {
      log("SKIP", `Banned sub r/${sub}`);
      continue;
    }

    log("SEARCH", `r/${sub} [${type}]`);

    try {
      await wait(2000);
      const posts = await reddit.getSubreddit(sub).getNew({ limit: 50 });

      for (const post of posts) {
        if (commentsThisCycle >= MAX_COMMENTS_PER_CYCLE) break;
        if (!post.author || !isFresh(post)) continue;

        const subName = post.subreddit?.display_name || post.subreddit || "";
        const titleLower = (post.title || "").toLowerCase();
        const subLower = subName.toLowerCase();

        // Skip banned subs
        if (banned.some(b => b.toLowerCase() === subLower)) continue;

        // Skip blocked subs
        if (BLOCK_SUBS.some(b => subLower.includes(b.toLowerCase()))) {
          log("SKIP", `Blocked sub r/${subName}`);
          continue;
        }

        // Skip for hire / review / unrelated posts
        if (FOR_HIRE_BLOCK.some(s => titleLower.includes(s))) {
          log("SKIP", `Filtered title r/${subName}`);
          continue;
        }

        // Query match via Reddit search is sufficient targeting

        // Also block clearly wrong subs not in block list
        const EXTRA_BLOCK = ["sexpositive","relationship","dating","advice","women","men","askwomen","askmen","amiugly","confession","rant","venting","support","grief","mentalillness","bipolar","bpd","schizophrenia","ptsd","trauma","abuse","narcissist","divorce","breakup","ldr","polyamory","trueoffmychest","offmychest"];
        if (EXTRA_BLOCK.some(b => subLower.includes(b))) continue;

        // Skip already commented
        const postId = post.id || post.name;
        if (commented[postId]) continue;

        // Skip bot's own posts
        if (post.author?.name?.toLowerCase() === (process.env.REDDIT_USERNAME || "").toLowerCase()) continue;

        // Verify post title actually contains buyer intent words
        const BUYER_WORDS = ["need","looking","want","hire","hiring","help","build","find","get","where","how","recommend","suggest"];
        const hasBuyerWord = BUYER_WORDS.some(w => titleLower.includes(w));
        if (!hasBuyerWord) {
          log("SKIP", `No buyer word in title: "${titleLower.substring(0,50)}"`);
          continue;
        }

        const commentText = type === "DEVHIRE" ? pick(DEVHIRE_COMMENTS) : pick(MAPZAP_COMMENTS);

        try {
          await post.reply(commentText);
          commented[postId] = new Date().toISOString();
          saveCommented(commented);
          commentsThisCycle++;
          log("COMMENTED", `r/${subName} — "${titleLower.substring(0, 60)}"`);
          log("INFO", `${commentsThisCycle}/${MAX_COMMENTS_PER_CYCLE} comments. Waiting ${Math.round(MIN_DELAY_MS/60000)} to ${Math.round(MAX_DELAY_MS/60000)}min...`);
          await sleep(rand(MIN_DELAY_MS, MAX_DELAY_MS));
        } catch (err) {
          const msg = err.message || "";
          if (msg.includes("SUBREDDIT_NOTALLOWED") || msg.includes("BANNED") || msg.includes("forbidden") || msg.includes("403")) {
            log("BANNED", `r/${subName}`);
            const b = loadBanned();
            if (!b.includes(subName)) { b.push(subName); fs.writeFileSync(BANNED_PATH, JSON.stringify(b, null, 2)); }
          } else if (msg.includes("RATELIMIT") || msg.includes("rate limit")) {
            log("RATELIMIT", `Waiting 15min...`);
            await sleep(15 * 60 * 1000);
          } else {
            log("ERROR", `${msg}`);
          }
        }

        await wait(rand(2000, 4000));
      }
    } catch (err) {
      log("ERROR", `Sub fetch failed r/${sub}: ${err.message}`);
      await wait(15000);
    }
  }

  log("INFO", `Cycle complete. Commented on ${commentsThisCycle} posts.`);
}

(async () => {
  console.log("=".repeat(60));
  console.log("RedditCommenter -- Global Comment Bot");
  console.log("=".repeat(60));
  while (true) {
    await runCycle();
    log("INFO", `Next cycle in ${Math.round(CYCLE_INTERVAL_MS / 60000)} minutes.`);
    await sleep(CYCLE_INTERVAL_MS);
  }
})();
