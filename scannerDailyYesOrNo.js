import fetch from "node-fetch";
import fs from "fs";

// ================= CONFIG =================
const MARKET_SLUGS = [
  // 👇 YOU curate these manually
  "will-the-fed-cut-rates-in-january",
  "will-bitcoin-close-above-45000-today",
  "will-ethereum-outperform-bitcoin-today"
];

const MAX_HOURS_TO_CLOSE = 4;
const MIN_PROBABILITY = 0.80;
const MAX_PROBABILITY = 0.99;

// ================= UTILS =================
function hoursUntil(iso) {
  return (new Date(iso).getTime() - Date.now()) / 36e5;
}

async function fetchMarket(slug) {
  const url = `https://gamma-api.polymarket.com/markets?slug=${slug}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Market fetch failed");
  const data = await res.json();
  return data[0];
}

async function fetchOrderbook(tokenId) {
  const url = `https://clob.polymarket.com/book?token_id=${tokenId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Orderbook fetch failed");
  return res.json();
}

// ================= SCANNER =================
async function scan() {
  console.log(
    `\n[${new Date().toLocaleTimeString()}] Scanning DAILY Yes/No markets…\n`
  );

  const results = [];

  for (const slug of MARKET_SLUGS) {
    console.log(`🔍 Checking ${slug}`);

    let market;
    try {
      market = await fetchMarket(slug);
    } catch {
      console.log("⚠️  Market fetch failed\n");
      continue;
    }

    if (!market?.endDate || !market?.clobTokenIds) {
      console.log("⚠️  Missing required market fields\n");
      continue;
    }

    // ---- TIME FILTER ----
    const hrs = hoursUntil(market.endDate);
    if (hrs > MAX_HOURS_TO_CLOSE || hrs <= 0) {
      console.log(`❌ Closes in ${hrs.toFixed(2)}h\n`);
      continue;
    }

    // ---- PRICE FILTER ----
    const yesPrice = Number(JSON.parse(market.outcomePrices)[0]);

    if (yesPrice < MIN_PROBABILITY) {
      console.log(`❌ YES price ${yesPrice} < ${MIN_PROBABILITY}\n`);
      continue;
    }

    if (yesPrice > MAX_PROBABILITY) {
      console.log(`❌ YES price ${yesPrice} > ${MAX_PROBABILITY}\n`);
      continue;
    }

    // ---- ORDERBOOK ----
    const [yesToken] = JSON.parse(market.clobTokenIds);

    let book;
    try {
      book = await fetchOrderbook(yesToken);
    } catch {
      console.log("⚠️  Orderbook fetch failed\n");
      continue;
    }

    if (!book.asks || book.asks.length === 0) {
      console.log("⚠️  Orderbook empty\n");
      continue;
    }

    // ---- LOWEST ASK (IMPORTANT FIX) ----
    const bestAsk = Math.min(...book.asks.map(a => Number(a.price)));

    const samePriceAsks = book.asks.filter(
      a => Number(a.price) === bestAsk
    );

    const totalSize = samePriceAsks.reduce(
      (sum, a) => sum + Number(a.size), 0
    );

    const liquidityUSD = totalSize * bestAsk;

    console.log(
      `📊 Ask: ${bestAsk} | Size: ${totalSize.toFixed(2)} | Liquidity: $${liquidityUSD.toFixed(2)}`
    );

    if (liquidityUSD < 1) {
      console.log("❌ Dust liquidity\n");
      continue;
    }

    console.log("✅ ELIGIBLE\n");

    // ---- SAVE RESULT (COMMON FORMAT) ----
    results.push({
      slug,
      endDate: market.endDate,
      hoursToClose: Number(hrs.toFixed(2)),
      yesPrice,
      bestAsk,
      askSize: totalSize,
      liquidityUSD: Number(liquidityUSD.toFixed(2)),
      tokenId: yesToken,
      marketType: "daily_yes_no"
    });
  }

  const output = {
    timestamp: new Date().toISOString(),
    scannerType: "daily_yes_no",
    markets: results
  };

  fs.writeFileSync(
    "./scanner-output.json",
    JSON.stringify(output, null, 2)
  );

  console.log(`🏁 Scan complete. Valid markets: ${results.length}`);
  console.log("📁 Saved to scanner-output.json\n");
}

scan().catch(err => {
  console.error("💥 SCANNER CRASHED:", err.message);
});
