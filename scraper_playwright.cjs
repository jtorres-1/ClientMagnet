require("dotenv").config();
const fs = require("fs");
const { chromium } = require("playwright");
const { createObjectCsvWriter } = require("csv-writer");

const csvPath = "logs/automation_clients.csv";

const writer = createObjectCsvWriter({
  path: csvPath,
  header: [
    { id: "username", title: "Username" },
    { id: "title", title: "Post Title" },
    { id: "url", title: "Post URL" },
    { id: "subreddit", title: "Subreddit" },
    { id: "time", title: "Timestamp" },
  ],
  append: true,
});

const subs = [
  "slavelabour",
  "forhire",
  "jobbit",
  "WorkOnline",
  "RemoteJobs",
  "ExperiencedDevs",
  "Automation",
  "freelance_forhire",
  "techjobs",
  "remotedev",
  "programmingrequests",
  "codingjobs",
  "developers",
  "RemoteWork",
  "devjobs",
  "freelance",
  "hiring",
];

const buyerCues = [
  "need help",
  "looking for",
  "hire",
  "hiring",
  "developer needed",
  "help automate",
  "bot needed",
  "custom script",
  "automation help",
  "project help",
  "paid project",
  "freelancer",
  "contract",
];

const techCues = [
  "automation",
  "bot",
  "script",
  "scraper",
  "python",
  "api",
  "selenium",
  "playwright",
  "discord",
  "telegram",
  "web",
  "backend",
  "frontend",
  "fullstack",
  "node",
  "flask",
  "django",
  "data extraction",
];

const paymentCues = [
  "$",
  "usd",
  "hour",
  "paid",
  "budget",
  "bounty",
  "compensate",
  "payment",
  "rate",
  "offer",
  "price",
  "cash",
];

const banned = [
  "for hire",
  "offering",
  "portfolio",
  "hire me",
  "commission",
  "partner",
  "collab",
  "looking for clients",
  "looking to collaborate",
  "my tool",
  "i built",
  "i made",
  "i create",
  "launching",
  "startup",
  "demo",
  "feedback",
  "my project",
  "my saas",
];

function isQualified(text) {
  text = text.toLowerCase();
  if (banned.some((w) => text.includes(w))) return false;
  const buyer = buyerCues.some((w) => text.includes(w));
  const tech = techCues.some((w) => text.includes(w));
  const pay = paymentCues.some((w) => text.includes(w));
  return buyer && tech && (pay || text.includes("remote"));
}

async function scrape() {
  console.log("🚀 Launching Playwright browser...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let allLeads = [];

  for (const sub of subs) {
    console.log(`📂 Scanning r/${sub} ...`);
    const url = `https://www.reddit.com/r/${sub}/search/?q=hiring+developer+OR+automation+OR+bot+OR+script&sort=new&t=month`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Scroll deeper for more results
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 2500);
      await page.waitForTimeout(1000);
    }

    const posts = await page.$$eval("shreddit-post", (nodes) =>
      nodes.map((el) => ({
        title: el.querySelector("h3")?.innerText || "",
        text: el.innerText || "",
        url: el.querySelector("a[data-click-id='body']")?.href || "",
        author: el.getAttribute("author") || "unknown",
      }))
    );

    const filtered = posts.filter(
      (p) => p.title && isQualified(p.title + " " + p.text)
    );

    filtered.forEach((p) =>
      allLeads.push({
        username: p.author,
        title: p.title,
        url: p.url,
        subreddit: sub,
        time: new Date().toISOString(),
      })
    );
  }

  await browser.close();

  if (!allLeads.length) {
    console.log("⚠️  No leads found.");
    return;
  }

  let existing = "";
  if (fs.existsSync(csvPath)) existing = fs.readFileSync(csvPath, "utf8");
  const unique = allLeads.filter((lead) => !existing.includes(lead.url));

  if (!unique.length) {
    console.log("⚠️  All duplicates skipped.");
    return;
  }

  await writer.writeRecords(unique);
  console.log(`✅ Saved ${unique.length} verified paying automation client leads.`);
}

scrape().catch(console.error);
