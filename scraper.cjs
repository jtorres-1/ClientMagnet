require("dotenv").config();
const fs = require("fs");
const path = require("path");
const snoowrap = require("snoowrap");

// Reddit client
const reddit = new snoowrap({
  userAgent: process.env.REDDIT_USER_AGENT,
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
});

// Output directory
const baseDir = path.resolve(__dirname, "logs");
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir);

// Output CSV
const leadsPath = path.join(baseDir, "clean_leads.csv");

// DMed history
const dmedFiles = [
  "clean_leads_dmed.csv",
  "all_dmed.csv",
  "lead_finder_buyers_dmed.csv",
  "lead_finder_sellers_dmed.csv"
];

// Create header if needed
if (!fs.existsSync(leadsPath)) {
  fs.writeFileSync(
    leadsPath,
    "username,title,url,subreddit,time,leadType\n"
  );
}

// Prepend row
function prependLead(file, rowObj) {
  const row = Object.values(rowObj).join(",") + "\n";
  const existing = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, row + existing);
}

// Load all previously contacted users
function loadDMedUsers() {
  const set = new Set();

  for (const f of dmedFiles) {
    const full = path.join(baseDir, f);
    if (!fs.existsSync(full)) continue;

    const lines = fs.readFileSync(full, "utf8").split("\n");
    for (let line of lines) {
      const user = line.split(",")[0];
      if (user) set.add(user.toLowerCase());
    }
  }

  // JSON sentState
  const jsonPath = path.join(baseDir, "clean_leads_sentState.json");
  if (fs.existsSync(jsonPath)) {
    try {
      const json = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      if (json.usernames) {
        json.usernames.forEach(u => set.add(u.toLowerCase()));
      }
    } catch {}
  }

  return set;
}

/* ============================================
   UFC / MMA / BETTING SUBREDDITS
============================================ */
const subs = [
  "ufc",
  "mma",
  "mmabetting",
  "sportsbetting",
  "MMApropbets",
  "MMAPicks",
  "MMA_Talk",
  "MMAoddsmath",
  "Sportsbook",
  "DraftKingsDiscussion",
  "betting",
  "ParlayPurgatory",
  "Gambling",
];

/* ============================================
   CombatIQ TARGET PHRASES
   (find people asking for predictions)
============================================ */
const combatIQTriggers = [
  "who wins",
  "prediction",
  "predictions",
  "picks",
  "pick",
  "parlay",
  "bets",
  "betting",
  "underdog",
  "favorite",
  "odds",
  "who you got",
  "thoughts on",
  "fight breakdown",
  "breakdown",
  "prop",
  "over under",
  "o/u",
  "lock",
  "slip",
  "wager",
  "fight iq",
  "ai prediction",
  "topuria",
  "volkanovski",
  "holloway",
  "mcgregor",
  "ufc",
  "mma",
  "card",
  "main event",
  "co main",
];

/* ============================================
   4 DAY WINDOW
============================================ */
function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 96;
}

/* ============================================
   CLASSIFY USER AS UFC / BETTING LEAD
============================================ */
function classify(post) {
  const text =
    (post.title + " " + (post.selftext || "")).toLowerCase();

  if (combatIQTriggers.some((x) => text.includes(x))) {
    return "UFC-BETTOR";
  }
  return null;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================
   SCRAPER
============================================ */
async function scrape() {
  console.log("Starting CombatIQ Scraper — UFC & Bettor Mode…");

  const dmedUsers = loadDMedUsers();

  const existingUrls = new Set(
    fs.readFileSync(leadsPath, "utf8")
      .split("\n")
      .map((l) => l.split(",")[2])
  );

  let leads = 0;

  for (const sub of subs) {
    console.log(`\nSearching r/${sub}`);

    try {
      await wait(3000);

      let posts = await reddit
        .getSubreddit(sub)
        .getNew({ limit: 60 });

      posts = posts.filter(
        (p) =>
          p.author &&
          isFresh(p) &&
          !dmedUsers.has(p.author.name.toLowerCase())
      );

      for (const p of posts) {
        const type = classify(p);
        if (!type) continue;

        const username = p.author.name.toLowerCase();
        if (dmedUsers.has(username)) continue;

        const url = `https://reddit.com${p.permalink}`;
        if (existingUrls.has(url)) continue;

        const row = {
          username: p.author.name,
          title: `"${p.title.replace(/"/g, "'")}"`,
          url,
          subreddit: sub,
          time: new Date(p.created_utc * 1000).toISOString(),
          leadType: type,
        };

        prependLead(leadsPath, row);
        existingUrls.add(url);
        leads++;
      }

      await wait(2000);
    } catch (err) {
      console.log(`Error in r/${sub}: ${err.message}`);
      await wait(45000);
    }
  }

  console.log(
    `\nScrape done — UFC Betting Leads Found: ${leads}\nSleeping 2 hours…\n`
  );
}

(async () => {
  while (true) {
    await scrape();
    await wait(2 * 60 * 60 * 1000);
  }
})();
