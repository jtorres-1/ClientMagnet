// merge_history.js
// Permanently merge ALL historical usernames into Lead Finder blocklist

const fs = require("fs");
const path = require("path");

// Paths
const logsDir = "/root/ClientMagnet/logs";

// Lead Finder active files
const lfDmedCsv = path.join(logsDir, "lead_finder_clients_dmed.csv");
const lfSentStateJson = path.join(logsDir, "lead_finder_clients_sentState.json");
const lfSentCacheJson = path.join(logsDir, "lead_finder_clients_sentCache.json");

// Automation historical files
const automationFiles = [
  "automation_clients.csv",
  "automation_clients_dmed.csv",
  "automation_clients_dmed_old.csv",
  "automation_clients_sentState.json",
  "automation_clients_sentCache.json"
];

// Helper to extract usernames from a CSV row
function extractCsvUsernames(file) {
  const raw = fs.readFileSync(file, "utf8").split("\n");
  const usernames = [];

  raw.forEach(line => {
    const cols = line.split(",");
    if (!cols.length) return;

    const username = cols[0].replace(/[^a-zA-Z0-9-_]/g, "").trim();
    if (username && username !== "username") {
      usernames.push(username.toLowerCase());
    }
  });

  return usernames;
}

// Helper to extract usernames from JSON
function extractJsonUsernames(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const data = JSON.parse(raw);

    const users = [];

    if (Array.isArray(data)) {
      data.forEach(u => users.push(String(u).toLowerCase()));
    } else if (data && typeof data === "object") {
      if (Array.isArray(data.usernames)) {
        data.usernames.forEach(u => users.push(String(u).toLowerCase()));
      }
      if (Array.isArray(data.urls)) {
        // URLs not needed here
      }
    }

    return users;
  } catch (err) {
    console.log("JSON parse fail", file, err.message);
    return [];
  }
}

// Load all existing Lead Finder usernames first
let globalUsers = new Set();

// Load existing LF dmed.csv
if (fs.existsSync(lfDmedCsv)) {
  extractCsvUsernames(lfDmedCsv).forEach(u => globalUsers.add(u));
}

// Load existing LF sentState.json
if (fs.existsSync(lfSentStateJson)) {
  extractJsonUsernames(lfSentStateJson).forEach(u => globalUsers.add(u));
}

// Load existing LF sentCache.json
if (fs.existsSync(lfSentCacheJson)) {
  extractJsonUsernames(lfSentCacheJson).forEach(u => globalUsers.add(u));
}

// Merge automation history
automationFiles.forEach(file => {
  const filePath = path.join(logsDir, file);
  if (!fs.existsSync(filePath)) return;

  if (file.endsWith(".csv")) {
    extractCsvUsernames(filePath).forEach(u => globalUsers.add(u));
  } else if (file.endsWith(".json")) {
    extractJsonUsernames(filePath).forEach(u => globalUsers.add(u));
  }
});

console.log("Total merged usernames:", globalUsers.size);

// Rewrite Lead Finder blocklist files

// 1. Rewrite LF dmed.csv
const lfCsvHeader = "username,title,url,subreddit,time,status\n";
let lfCsvOut = lfCsvHeader;
globalUsers.forEach(u => {
  lfCsvOut += `${u},,,,,MERGED\n`;
});
fs.writeFileSync(lfDmedCsv, lfCsvOut);

// 2. Rewrite LF sentState.json
const outState = {
  urls: [],
  usernames: [...globalUsers]
};
fs.writeFileSync(lfSentStateJson, JSON.stringify(outState, null, 2));

// 3. Rewrite LF sentCache.json
const outCache = {
  urls: [],
  usernames: [...globalUsers]
};
fs.writeFileSync(lfSentCacheJson, JSON.stringify(outCache, null, 2));

console.log("Merge complete. Lead Finder blocklist updated with all history.");
