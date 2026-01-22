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
   SUBREDDITS - UFC BETTING FOCUS
   
   PRIMARY TARGETS (high betting intent):
   - MMA_Betting: Pure betting discussions
   - MMAbetting: Alternative betting community
   - sportsbook: Crossover betting community
   - sportsbetting: General betting with UFC traffic
   
   SECONDARY TARGETS (pick-seeking behavior):
   - ufc: Main sub, filter for betting posts only
   - MMAPredictions: Prediction-focused
   
   AVOIDED:
   - r/mma (too large, meme-heavy, mod-aggressive)
   - Fighter-specific subs (low ROI)
   - Highlight/news subs (no intent)
========================= */
const subs = [
  // Primary betting subs (highest ROI)
  "MMAbetting",
  "sportsbook",
  "sportsbetting",

  // Prediction-seeking
  "MMAPredictions",
  
  // Main UFC (betting posts only)
  "ufc"
];

/* =========================
   PIPELINE A — BETTING PICKS (PRIMARY)
   
   High intent signals:
   - Asking for picks/predictions
   - Posting their own picks seeking validation
   - Discussing odds/lines
   - Parlay building
   - Lock seeking behavior
========================= */
const bettingIntentRegex = /(who.*got|who.*like|who.*taking|what.*pick|any.*pick|prediction|parlay|lock|best bet|value bet|confident|putting.*on|betting.*on|odds|line|favorites|underdogs|sleeper pick|your.*pick)/i;

const bettingTermsRegex = /(ufc|fight night|ppv|main card|prelims|main event|co-main|parlay|odds|line|spread|\+\d{3}|\-\d{3}|moneyline|prop|over\/under|ko\/tko|decision|submission|round|finish)/i;

/* =========================
   PIPELINE B — PREDICTION SEEKING (SECONDARY)
   
   Users asking questions about specific fighters or matchups
========================= */
const predictionSeekingRegex = /(who wins|who takes it|thoughts on|break.*down|analyze|how do you see|what do you think|confident in|worth.*bet|value in|should i|betting on)/i;

/* =========================
   CONTEXT VALIDATION
   
   Ensure it's about UFC/MMA, not other sports
========================= */
const ufcContextRegex = /(ufc|mma|fight|fighter|cage|octagon|dana|contender series|bellator|pfl)/i;

/* =========================
   HARD BLOCKS
   
   Exclude:
   - Memes and highlights
   - News/journalism
   - Drama/gossip
   - Technique discussion (no betting intent)
   - Sellers/touts
========================= */
const memeRegex = /(🔥|💀|😂|lmao|lmfao|bruh|💯|🐐)/;
const highlightRegex = /(highlight|clip|knockout|finish|submission)(?!.*bet)/i;
const newsRegex = /(breaking|report|confirm|announce|sign|contract|interview|press conference)(?!.*(bet|pick|odds))/i;
const dramaRegex = /(beef|trash talk|callout|twitter|instagram|drama)/i;
const techniqueRegex = /(technique|training|coaching|gym|sparring|how to)/i;
const sellerRegex = /(i sell|dm me|telegram|discord.*picks|join.*group|pay.*access|subscription|vip picks|guaranteed|units|roi|\d+\-\d+ record)/i;

/* =========================
   FRESH POSTS ONLY
   
   48 hours for betting (faster cycle than dev leads)
========================= */
function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 48;
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
  if (memeRegex.test(title)) return null;
  if (highlightRegex.test(title)) return null;
  if (newsRegex.test(title)) return null;
  if (dramaRegex.test(combined)) return null;
  if (techniqueRegex.test(combined)) return null;

  // Must be UFC/MMA related
  if (!ufcContextRegex.test(combined)) return null;

  /* ---------- BETTING PICKS PIPELINE ---------- */
  const isBettingIntent = 
    bettingIntentRegex.test(combined) && 
    bettingTermsRegex.test(combined);

  if (isBettingIntent) {
    const matched = 
      combined.match(bettingIntentRegex)?.[0] ||
      combined.match(bettingTermsRegex)?.[0] ||
      "betting";

    return {
      type: "BETTING_PICKS",
      trigger: matched
    };
  }

  /* ---------- PREDICTION SEEKING PIPELINE ---------- */
  const isPredictionSeeking =
    predictionSeekingRegex.test(combined) &&
    ufcContextRegex.test(combined);

  if (isPredictionSeeking) {
    const matched =
      combined.match(predictionSeekingRegex)?.[0] ||
      "prediction";

    return {
      type: "PREDICTION_SEEKING",
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
  console.log("Starting Client Magnet scraper (CombatIQ - UFC Betting Focus)…");

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
    await wait(45 * 60 * 1000);
  }
})();
