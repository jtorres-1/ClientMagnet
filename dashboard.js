// dashboard.js — ClientMagnet Dashboard
// Reads clean_leads.csv and clean_leads_dmed.csv directly, no database.
// Run as its own PM2 process alongside the scraper and DM bot.

const express = require("express");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const app = express();
const PORT = process.env.DASHBOARD_PORT || 4400;
const baseDir = path.resolve(__dirname, "logs");
const leadsPath = path.join(baseDir, "clean_leads.csv");
const sentPath = path.join(baseDir, "clean_leads_dmed.csv");

function readCsv(filePath) {
  return new Promise(resolve => {
    if (!fs.existsSync(filePath)) return resolve([]);
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", row => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", () => resolve(rows));
  });
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const key = row[field] || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function todayCount(rows, timeField) {
  const today = new Date().toISOString().slice(0, 10);
  return rows.filter(r => (r[timeField] || "").startsWith(today)).length;
}

app.get("/", async (req, res) => {
  const leads = await readCsv(leadsPath);
  const sent = await readCsv(sentPath);

  const leadsByVertical = countBy(leads, "Vertical");
  const sentByVertical = countBy(sent, "Vertical");
  const leadsToday = todayCount(leads, "Time");
  const sentToday = todayCount(sent, "Time");

  const recentLeads = leads.slice(-15).reverse();
  const recentSent = sent.slice(-15).reverse();

  const row = (label, val) => `<tr><td>${label}</td><td>${val}</td></tr>`;
  const verticalRows = (obj) => Object.entries(obj).map(([k, v]) => row(k, v)).join("");

  res.send(`
<!DOCTYPE html>
<html>
<head>
<title>ClientMagnet Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { background:#000; color:#e4e8f0; font-family: -apple-system, sans-serif; padding: 24px; }
  h1 { color:#fff; font-size: 22px; }
  h2 { color:#5c90ff; font-size: 16px; margin-top: 32px; }
  table { width:100%; border-collapse: collapse; margin-top: 8px; }
  td { padding: 8px 10px; border-bottom: 1px solid #23272f; font-size: 14px; }
  .stat-grid { display:flex; gap:16px; flex-wrap:wrap; margin-top:12px; }
  .stat { background:#0d0f14; border:1px solid #23272f; border-radius:10px; padding:16px 20px; min-width:140px; }
  .stat .num { font-size:28px; font-weight:700; color:#5c90ff; }
  .stat .label { font-size:12px; color:#8b93a1; margin-top:4px; }
  a { color:#5c90ff; }
</style>
</head>
<body>
  <h1>ClientMagnet — Live Dashboard</h1>
  <div class="stat-grid">
    <div class="stat"><div class="num">${leads.length}</div><div class="label">Total leads scraped</div></div>
    <div class="stat"><div class="num">${leadsToday}</div><div class="label">Leads today</div></div>
    <div class="stat"><div class="num">${sent.length}</div><div class="label">Total DMs sent</div></div>
    <div class="stat"><div class="num">${sentToday}</div><div class="label">DMs sent today</div></div>
  </div>

  <h2>Leads by vertical</h2>
  <table>${verticalRows(leadsByVertical)}</table>

  <h2>DMs sent by vertical</h2>
  <table>${verticalRows(sentByVertical)}</table>

  <h2>Recent leads</h2>
  <table>
    ${recentLeads.map(l => `<tr><td>${l.Time?.slice(0,16)}</td><td>${l.Vertical}</td><td>u/${l.Username}</td><td><a href="${l.URL}" target="_blank">post</a></td></tr>`).join("")}
  </table>

  <h2>Recent DMs sent</h2>
  <table>
    ${recentSent.map(s => `<tr><td>${s.Time?.slice(0,16)}</td><td>${s.Vertical}</td><td>u/${s.Username}</td><td>${s['Template ID'] || s.templateId || ""}</td></tr>`).join("")}
  </table>
</body>
</html>
  `);
});

app.listen(PORT, () => console.log(`ClientMagnet dashboard running on port ${PORT}`));
