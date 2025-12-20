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

// DMed history files
const dmedFiles = [
  "clean_leads_dmed.csv",
  "all_dmed.csv",
  "lead_finder_buyers_dmed.csv",
  "lead_finder_sellers_dmed.csv"
];

// CSV Header
const HEADER = "username,title,url,subreddit,time,leadType";

// Ensure CSV exists and header is clean
if (!fs.existsSync(leadsPath)) {
  fs.writeFileSync(leadsPath, HEADER + "\n");
} else {
  const content = fs.readFileSync(leadsPath, "utf8").split("\n");
  if (!content[0].startsWith("username")) {
    content.unshift(HEADER);
    fs.writeFileSync(leadsPath, content.join("\n"));
  }
}

// Insert lead under header
function prependLead(file, rowObj) {
  const row = Object.values(rowObj).join(",") + "\n";
  let lines = fs.readFileSync(file, "utf8").split("\n");

  if (!lines[0].startsWith("username")) {
    lines.unshift(HEADER);
  }

  lines.splice(1, 0, row.trim());
  fs.writeFileSync(file, lines.join("\n"));
}

// Load users already DMed
function loadDMedUsers() {
  const set = new Set();

  for (const f of dmedFiles) {
    const full = path.join(baseDir, f);
    if (!fs.existsSync(full)) continue;

    const lines = fs.readFileSync(full, "utf8").split("\n");
    for (const line of lines) {
      const user = line.split(",")[0];
      if (user) set.add(user.toLowerCase());
    }
  }

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
   TARGET SUBREDDITS — PAID DEV GIGS ONLY
============================================ */
const subs = [
  "forhire",
  "freelance",
  "SideProject",
  "SaaS",
  "Entrepreneur",
  "EntrepreneurRideAlong",
  "Startup_Ideas"
];

/* ============================================
   HIGH-INTENT DEV GIG KEYWORDS
============================================ */
const sniperTriggers = [
  "looking for a developer",
  "looking for dev",
  "need a developer",
  "need a dev",
  "hire a developer",
  "hire developer",
  "hire freelancer",
  "developer needed",
  "script needed",
  "need a script",
  "build a bot",
  "automation help",
  "scraper needed",
  "api help",
  "mvp help",
  "mvp developer"
];

// Fresh posts only (speed matters)
function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 6;
}

// Classify dev gig intent
function classify(post) {
  const text = (post.title + " " + (post.selftext || "")).toLowerCase();
  if (sniperTriggers.some(t => text.includes(t))) return "DEV-GIG";
  return null;
}

const wait = ms => new Promise(res => setTimeout(res, ms));

/* ============================================
   SCRAPER LOOP
============================================ */
async function scrape() {
  console.log("Starting Dev Gig Scraper…");

  const dmedUsers = loadDMedUsers();

  const existingUrls = new Set(
    fs.readFileSync(leadsPath, "utf8")
      .split("\n")
      .map(l => l.split(",")[2])
  );

  let leads = 0;

  for (const sub of subs) {
    console.log(`\nScanning r/${sub}`);

    try {
      await wait(3000);

      let posts = await reddit.getSubreddit(sub).getNew({ limit: 60 });

      posts = posts.filter(
        p =>
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
          leadType: type
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

  console.log(`\nScrape complete — Dev gigs found: ${leads}`);
  console.log("Sleeping 2 hours…\n");
}

// Loop forever
(async () => {
  while (true) {
    await scrape();
    await wait(2 * 60 * 60 * 1000);
  }
})();
