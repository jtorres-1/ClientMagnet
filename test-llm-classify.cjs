// test-llm-classify.cjs — Standalone test, run manually, does NOT touch production
// Usage: node test-llm-classify.cjs

const OLLAMA_URL = "https://25ee-2603-8000-c93f-49c1-100c-19e8-6d5-9461.ngrok-free.app";
const MODEL = "qwen2.5:14b";

async function classifyWithLLM(postText, product) {
  const prompt = product === "TRADINGBOT"
    ? `You are screening Reddit posts to find people who want to HIRE someone to build/automate a trading bot for them, and who have a real strategy or budget signal. 

REJECT posts where the author: already built their own bot/strategy, is offering their own dev/trading services, is a total beginner with no capital, or is just asking general questions with no hiring intent.

Post: "${postText.slice(0, 500)}"

Reply with ONLY one word: HIRE or REJECT`
    : `You are screening Reddit posts to find people who want to HIRE a developer to build something for them.

REJECT posts where the author: is describing something they already built, is offering their own dev services for hire, or has no real project/budget intent.

Post: "${postText.slice(0, 500)}"

Reply with ONLY one word: HIRE or REJECT`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.1, num_predict: 10 }
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!res.ok) return { ok: false, verdict: null, reason: `HTTP ${res.status}` };

    const data = await res.json();
    const verdict = (data.response || "").trim().toUpperCase();

    if (verdict.includes("HIRE")) return { ok: true, verdict: "HIRE" };
    if (verdict.includes("REJECT")) return { ok: true, verdict: "REJECT" };
    return { ok: true, verdict: "UNCLEAR", raw: verdict };

  } catch (err) {
    return { ok: false, verdict: null, reason: err.message };
  }
}

// ─── TEST CASES — real examples from tonight's session ────────────────────────
const testCases = [
  {
    label: "Should REJECT — already built own app",
    product: "DEVHIRE",
    text: "I am currently developing a fully automated trading bot in Python designed to generate consistent monthly income. The bot is already functional from a technical standpoint."
  },
  {
    label: "Should REJECT — offering own services",
    product: "DEVHIRE",
    text: "I've built similar tools before including scrapers and workflow automation for businesses. Available for hire, check out my portfolio."
  },
  {
    label: "Should HIRE — real project, real spec",
    product: "DEVHIRE",
    text: "I need someone to build a middleware system connecting my Bubble app to a Raspberry Pi with NFC readers and RFID dispensers. Budget is flexible, need this built properly."
  },
  {
    label: "Should REJECT — beginner no capital",
    product: "TRADINGBOT",
    text: "I'm interested in automate trade bots plz guide man, I don't know much about coding"
  },
  {
    label: "Should HIRE — real trader wants automation",
    product: "TRADINGBOT",
    text: "I have a strategy using EMA 9 + VWAP + ATR trailing stop that I trade manually on gold. Want to automate execution on Apex or Lucid. Budget 150-250 to start."
  },
];

(async () => {
  console.log("=".repeat(70));
  console.log("Testing LLM classification against Ollama (Mac, via ngrok)");
  console.log("=".repeat(70));

  for (const tc of testCases) {
    console.log(`\n--- ${tc.label} ---`);
    console.log(`Text: "${tc.text.slice(0, 80)}..."`);
    const start = Date.now();
    const result = await classifyWithLLM(tc.text, tc.product);
    const elapsed = Date.now() - start;

    if (!result.ok) {
      console.log(`❌ FAILED (${elapsed}ms) — reason: ${result.reason}`);
      console.log(`   -> Fallback to regex-only would trigger here in production`);
    } else {
      console.log(`✓ Response (${elapsed}ms): ${result.verdict}`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("Test complete. Review results above before wiring into scraper.cjs");
  console.log("=".repeat(70));
})();
