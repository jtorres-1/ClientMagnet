/**
 * GLOBAL MERGE SCRIPT
 * Scans ALL CSV + JSON history in logs and produces
 * one unified master username blocklist.
 */

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

// folder
const baseDir = path.resolve(__dirname, "logs");

// all files inside logs
const files = fs.readdirSync(baseDir);

// final master username set
const master = new Set();

// helper to process csv files
async function readCsv(filePath) {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath).pipe(csv());
    stream
      .on("data", (row) => {
        if (row.username) {
          master.add(row.username.trim().toLowerCase());
        }
      })
      .on("end", () => resolve())
      .on("error", () => resolve());
  });
}

// helper to process json files
function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);

    if (Array.isArray(data)) {
      data.forEach((u) => master.add(String(u).trim().toLowerCase()));
    } else if (typeof data === "object") {
      if (Array.isArray(data.usernames)) {
        data.usernames.forEach((u) =>
          master.add(String(u).trim().toLowerCase())
        );
      }
      if (Array.isArray(data.urls)) {
        // ignore URLs for this fix
      }
    }
  } catch (e) {}
}

// MAIN RUNNER
(async () => {
  console.log("Scanning logs...");

  for (const f of files) {
    const full = path.join(baseDir, f);

    if (f.endsWith(".csv")) {
      console.log("CSV:", f);
      await readCsv(full);
    }

    if (f.endsWith(".json")) {
      console.log("JSON:", f);
      readJson(full);
    }
  }

  console.log(`\nTotal unique usernames: ${master.size}`);

  const finalData = {
    urls: [],
    usernames: [...master],
  };

  // overwrite both state files
  fs.writeFileSync(
    path.join(baseDir, "automation_clients_sentState.json"),
    JSON.stringify(finalData, null, 2)
  );

  fs.writeFileSync(
    path.join(baseDir, "lead_finder_clients_sentState.json"),
    JSON.stringify(finalData, null, 2)
  );

  console.log("\nGLOBAL MERGE COMPLETE.");
  console.log("Lifetime blocklist updated.");
})();
