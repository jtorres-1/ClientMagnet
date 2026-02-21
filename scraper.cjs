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
   SUBREDDITS — FLIPIFY TARGETS
   
   Car flipping, reselling, auction buying,
   marketplace sellers, side hustle dealers
========================= */
const subs = [
  "carflipping",
  "usedcars",
  "askcarsales",
  "flipping",
  "sidehustle",
  "Entrepreneur",
  "carbuying",
  "auctions",
  "Flipping",
  "smallbusiness",
  "MechanicAdvice",
  "cardeals",
  "whatcarshouldibuy"
];

/* =========================
   PRIMARY KEYWORDS — CAR FLIPPING CONTEXT
   
   Must match car/vehicle reselling activity.
   Categories:
   - Vehicle types: car, vehicle, truck, suv, sedan, coupe, van
   - Flip activity: flip, flipping, resell, reselling, wholesale, retail
   - Auction platforms: copart, manheim, iaai, adesa, auction
   - Marketplace: facebook marketplace, craigslist, autotrader, carvana, carmax
   - Lot / dealer: lot, dealer, dealership, independent dealer, buy here pay here
========================= */
const primaryKeywordRegex = /\b(car|cars|vehicle|vehicles|truck|trucks|suv|sedan|coupe|van|auto|autos|flip|flipping|flipped|resell|reselling|resale|wholesale|retail|copart|manheim|iaai|adesa|auction|auctions|facebook marketplace|craigslist|autotrader|carvana|carmax|lot|dealer|dealership|independent dealer|buy here pay here|bhph|salvage|rebuilt title|clean title|odometer)\b/i;

/* =========================
   PAIN SIGNALS — FLIPIFY-SPECIFIC
   
   Targets financial pain, miscalculation, thin margins,
   repair surprises, pricing confusion, overpaying
========================= */
const painSignalRegex = /\b(lost money|losing money|lost on|broke even|barely broke even|thin margin|margins|not profitable|not worth it|ate the cost|underwater|overpaid|overbid|bid too high|auction mistake|should have walked|shouldn't have bought|hidden damage|unexpected repair|didn't account|more than i thought|cost me more|mechanic said|body work|paint|transmission|engine|timing|cost to fix|repair cost|repair estimate|couldn't sell|no offers|sitting|dropped price|price drop|had to lower|kbb|kelly blue book|book value|market value|comp|comps|comparable|how do you price|how do you calculate|how do you know|profit formula|spreadsheet|track costs|figure out|roi|return|margin|break even|what did you pay|what did you sell|how much did you make|how much profit|gut feeling|guessing|estimate|miscalculate|underestimated)\b/i;

/* =========================
   FLIPPER / RESELLER SIGNALS (BONUS — NOT REQUIRED)
   
   Confirms the poster is actively flipping, not just buying
========================= */
const flipperSignalRegex = /\b(i flip|i flipped|i resell|i buy and sell|i bought|i picked up|i got|i sold|i listed|my flip|my car|my truck|my vehicle|bought at auction|bought from copart|bought from manheim|bought at|picked up for|selling for|listed for|asking|profit on|made on|lost on|been flipping|side hustle|extra income|supplement|part time|full time flip)\b/i;

/* =========================
   HARD BLOCKS — SKIP THESE
========================= */
const studentRegex = /\b(student|studying|in school|how do i become|getting into|career advice|thinking about becoming|new to this|just starting)\b/i;

const jobSeekerRegex = /\b(resume|cv|looking for work|need a job|job hunt|where to apply|anyone hiring|apply|application)\b/i;

const vendorRegex = /\b(we sell|our product|our software|check out our|try our|book a demo|free trial|discount code|affiliate|promo code)\b/i;

/* =========================
   FRESHNESS — 7 DAYS
   
   Extended window since car flip posts stay relevant longer
========================= */
function isFresh(post) {
  const ageHours = (Date.now() - post.created_utc * 1000) / 36e5;
  return ageHours <= 168; // 7 days
}

/* =========================
   CLASSIFIER — FLIPIFY TARGETING
   
   Requires: primary keyword + pain signal
   Bonus: flipper signal upgrades lead type
========================= */
function classify(post) {
  const title = (post.title || "").toLowerCase();
  const body = (post.selftext || "").toLowerCase();
  const combined = `${title} ${body}`;

  // Minimum quality
  if (title.length < 10) return null;

  /* ========== HARD BLOCKS FIRST ========== */
  if (studentRegex.test(combined)) return null;
  if (jobSeekerRegex.test(combined)) return null;
  if (vendorRegex.test(combined)) return null;

  /* ========== RULE 1: MUST BE CAR/VEHICLE RELATED ========== */
  if (!primaryKeywordRegex.test(combined)) return null;

  /* ========== RULE 2: MUST HAVE PAIN SIGNAL ========== */
  const hasPainSignal = painSignalRegex.test(combined);
  if (!hasPainSignal) return null;

  // Extract matched pain signal for DM context
  const painMatch = combined.match(painSignalRegex)?.[0] || "the flip";

  /* ========== CLASSIFICATION ========== */
  const hasFlipperSignal = flipperSignalRegex.test(combined);

  if (hasFlipperSignal) {
    return {
      type: "ACTIVE_FLIPPER_PAIN",   // Confirmed flipper with a pain point
      trigger: painMatch
    };
  }

  return {
    type: "RESELLER_PAIN",           // Likely reseller, pain present
    trigger: painMatch
  };
}

const wait = ms => new Promise(res => setTimeout(res, ms));

/* =========================
   SCRAPER LOOP
========================= */
async function scrape() {
  console.log("Starting Flipify scraper (Car Flipping / Reseller Validation)...");

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
   RUN LOOP — UNCHANGED FROM ORIGINAL
========================= */
(async () => {
  while (true) {
    await scrape();
    await wait(30 * 60 * 1000); // Every 30 minutes
  }
})();
