// dashboard.cjs — ClientMagnet Dashboard v2
// Reddit-branded theme (orange accent), subreddit shown per row,
// safer field fallbacks in case of any future header drift.

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

// Accept either header casing so a stray old file never silently
// prints "undefined" without at least trying the alternate key.
function field(row, ...keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== "") return row[k];
  }
  return "unknown";
}

function countBy(rows, ...keys) {
  const counts = {};
  for (const row of rows) {
    const key = field(row, ...keys);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function todayCount(rows, ...timeKeys) {
  const today = new Date().toISOString().slice(0, 10);
  return rows.filter(r => field(r, ...timeKeys).startsWith(today)).length;
}

app.get("/", async (req, res) => {
  const leads = await readCsv(leadsPath);
  const sent = await readCsv(sentPath);

  const leadsByVertical = countBy(leads, "Vertical", "vertical");
  const sentByVertical = countBy(sent, "Vertical", "vertical");
  const leadsToday = todayCount(leads, "Time", "time");
  const sentToday = todayCount(sent, "Time", "time");

  const recentLeads = leads.slice(-15).reverse();
  const recentSent = sent.slice(-15).reverse();

  const verticalRows = (obj) => Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");

  const leadRow = (l) => `<tr>
    <td>${field(l, "Time", "time").slice(0,16)}</td>
    <td><span class="pill">${field(l, "Vertical", "vertical")}</span></td>
    <td>r/${field(l, "Subreddit", "subreddit")}</td>
    <td>u/${field(l, "Username", "username")}</td>
    <td><a href="${field(l, "URL", "url")}" target="_blank">view post ↗</a></td>
  </tr>`;

  const sentRow = (s) => `<tr>
    <td>${field(s, "Time", "time").slice(0,16)}</td>
    <td><span class="pill">${field(s, "Vertical", "vertical")}</span></td>
    <td>r/${field(s, "Subreddit", "subreddit")}</td>
    <td>u/${field(s, "Username", "username")}</td>
    <td>${field(s, "Template ID", "templateId")}</td>
  </tr>`;

  res.send(`
<!DOCTYPE html>
<html>
<head>
<title>ClientMagnet — Reddit Lead Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --bg: #0b0b0d;
    --surface: #16161a;
    --line: #2a2a30;
    --reddit-orange: #ff4500;
    --white: #f1f1f3;
    --muted: #8e8e96;
  }
  * { box-sizing: border-box; }
  body { background: var(--bg); color: var(--white); font-family: -apple-system, "Segoe UI", sans-serif; padding: 32px; margin: 0; }
  .brand { display:flex; align-items:center; gap:12px; margin-bottom: 4px; }
  .brand-icon {
    width: 32px; height: 32px; border-radius: 50%;
    background: var(--reddit-orange);
    display:flex; align-items:center; justify-content:center;
    font-weight:800; color:#000; font-size:16px;
  }
  h1 { font-size: 22px; margin: 0; }
  .subtitle { color: var(--muted); font-size: 13px; margin: 4px 0 24px 44px; }
  h2 { color: var(--reddit-orange); font-size: 15px; margin-top: 36px; text-transform: uppercase; letter-spacing: 0.04em; }
  table { width:100%; border-collapse: collapse; margin-top: 10px; background: var(--surface); border-radius: 10px; overflow: hidden; }
  td { padding: 10px 14px; border-bottom: 1px solid var(--line); font-size: 13.5px; }
  tr:last-child td { border-bottom: none; }
  .stat-grid { display:flex; gap:16px; flex-wrap:wrap; margin-top:16px; }
  .stat { background: var(--surface); border:1px solid var(--line); border-radius:12px; padding:18px 22px; min-width:150px; }
  .stat .num { font-size:30px; font-weight:800; color: var(--reddit-orange); }
  .stat .label { font-size:12px; color: var(--muted); margin-top:4px; }
  .pill {
    background: rgba(255,69,0,0.12); color: var(--reddit-orange);
    border: 1px solid rgba(255,69,0,0.3);
    padding: 3px 9px; border-radius: 20px; font-size: 12px; font-weight: 600;
  }
  a { color: var(--reddit-orange); text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <div class="brand">
    <div class="brand-icon">r/</div>
    <h1>ClientMagnet — Reddit Lead Dashboard</h1>
  </div>
  <div class="subtitle">Tracking e-commerce, local service, and property management leads sourced from Reddit</div>

  <div class="stat-grid">
    <div class="stat"><div class="num">${leads.length}</div><div class="label">Total leads scraped</div></div>
    <div class="stat"><div class="num">${leadsToday}</div><div class="label">Leads today</div></div>
    <div class="stat"><div class="num">${sent.length}</div><div class="label">Total DMs sent</div></div>
    <div class="stat"><div class="num">${sentToday}</div><div class="label">DMs sent today</div></div>
  </div>

  <h2>Leads by vertical</h2>
  <table>${verticalRows(leadsByVertical) || '<tr><td colspan="2">No leads yet</td></tr>'}</table>

  <h2>DMs sent by vertical</h2>
  <table>${verticalRows(sentByVertical) || '<tr><td colspan="2">No DMs sent yet</td></tr>'}</table>

  <h2>Recent leads</h2>
  <table>
    <tr><td><b>Time</b></td><td><b>Vertical</b></td><td><b>Subreddit</b></td><td><b>User</b></td><td><b>Post</b></td></tr>
    ${recentLeads.map(leadRow).join("") || '<tr><td colspan="5">Nothing yet</td></tr>'}
  </table>

  <h2>Recent DMs sent</h2>
  <table>
    <tr><td><b>Time</b></td><td><b>Vertical</b></td><td><b>Subreddit</b></td><td><b>User</b></td><td><b>Template</b></td></tr>
    ${recentSent.map(sentRow).join("") || '<tr><td colspan="5">Nothing yet</td></tr>'}
  </table>
</body>
</html>
  `);
});

app.listen(PORT, () => console.log(`ClientMagnet dashboard running on port ${PORT}`));
