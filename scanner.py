import fetch from "node-fetch";

// ================= CONFIG =================
const POLL_INTERVAL_MS = 5000;
const USER_AGENT = "Mozilla/5.0";

// Known parent event slug (this is key)
const JAN14_EVENT_SLUG = "bitcoin-above-on-january-14";

// ================= UTILS =================
async function fetchHTML(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function extractNextData(html) {
  const match = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!match) throw new Error("__NEXT_DATA__ not found");
  return JSON.parse(match[1]);
}

function isJan14BitcoinRung(market) {
  const slug = (market.slug || "").toLowerCase();
  const question = (market.question || "").toLowerCase();

  return (
    slug.includes("bitcoin-above") &&
    (slug.includes("january-14") || question.includes("january 14"))
  );
}

// ================= CORE =================
async function fetchJan14BitcoinLadders() {
  console.clear();
  console.log(
    `[${new Date().toLocaleTimeString()}] Scanning Bitcoin January 14 ladder markets…`
  );

  const url = `https://polymarket.com/event/${JAN14_EVENT_SLUG}`;
  const html = await fetchHTML(url);
  const payload = extractNextData(html);

  const queries =
    payload?.props?.pageProps?.dehydratedState?.queries || [];

  let ladderMarkets = [];

  for (const q of queries) {
    const data = q?.state?.data;
    if (data?.markets && Array.isArray(data.markets)) {
      ladderMarkets = data.markets.filter(isJan14BitcoinRung);
      break;
    }
  }

  if (ladderMarkets.length === 0) {
    console.log("❌ No January 14 Bitcoin ladder markets found.");
    return;
  }

  console.log(`\n✅ Found ${ladderMarkets.length} Bitcoin ladder rungs:\n`);

  for (const m of ladderMarkets) {
    const [yesToken, noToken] = m.clobTokenIds || [];

    console.log(
      `🪜 ${m.question}\n` +
      `   Slug: ${m.slug}\n` +
      `   Market ID: ${m.id}\n` +
      `   YES Token: ${yesToken}\n` +
      `   NO  Token: ${noToken}\n`
    );
  }
}

// ================= LOOP =================
fetchJan14BitcoinLadders();

setInterval(() => {
  fetchJan14BitcoinLadders().catch(err =>
    console.error("Scanner error:", err.message)
  );
}, POLL_INTERVAL_MS);
