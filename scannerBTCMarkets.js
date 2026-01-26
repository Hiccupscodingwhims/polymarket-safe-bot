import fetch from "node-fetch";
import fs from "fs";

// ================= CONFIG =================
const DATE_LABEL = "january-24";
const STRIKES = [ 86, 88, 90, 92, 94, 96, 98, 100, 102];

const MAX_HOURS_TO_CLOSE = 4;
const MIN_PROBABILITY = 0.80;
const BUDGET_USD = 50;
const MAX_PROBABILITY = 0.99;   // 99% hard ceiling


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
    `\n[${new Date().toLocaleTimeString()}] Scanning Bitcoin ${DATE_LABEL} ladder markets…\n`
  );

  const results = [];

  for (const strike of STRIKES) {
    const slug = `bitcoin-above-${strike}k-on-${DATE_LABEL}`;
    console.log(`🔍 Checking ${slug}`);

    let market;
    try {
      market = await fetchMarket(slug);
    } catch {
      console.log("⚠️  Market fetch failed\n");
      continue;
    }

    // ---- TIME FILTER ----
    if (!market.endDate) {
      console.log("⚠️  Missing endDate\n");
      continue;
    }

    const hrs = hoursUntil(market.endDate);
    if (hrs > MAX_HOURS_TO_CLOSE || hrs <= 0) {
      console.log(`❌ Closes in ${hrs.toFixed(2)}h (rejected)\n`);
      continue;
    }

    // ---- PRICE FILTER ----
    // ---- PRICE FILTER ----
    const yesPrice = Number(JSON.parse(market.outcomePrices)[0]);

    if (yesPrice < MIN_PROBABILITY) {
      console.log(`❌ YES price ${yesPrice} < ${MIN_PROBABILITY}\n`);
      continue;
    }

    if (yesPrice > MAX_PROBABILITY) {
      console.log(`❌ YES price ${yesPrice} > ${MAX_PROBABILITY} (too close to resolution)\n`);
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

    // ---- BEST ASK + LIQUIDITY ----
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

    // ---- SAVE RESULT ----
    results.push({
      slug,
      strike,
      endDate: market.endDate,
      hoursToClose: Number(hrs.toFixed(2)),
      yesPrice,
      bestAsk,
      askSize: totalSize,
      liquidityUSD: Number(liquidityUSD.toFixed(2)),
      tokenId: yesToken
    });
  }

  // ---- WRITE OUTPUT ----
  const output = {
    timestamp: new Date().toISOString(),
    question: `bitcoin-above-on-${DATE_LABEL}`,
    markets: results
  };

  fs.writeFileSync(
    "./scanner-output.json",
    JSON.stringify(output, null, 2)
  );

  console.log(`🏁 Scan complete. Valid rungs: ${results.length}`);
  console.log("📁 Saved to scanner-output.json\n");
}

scan().catch(err => {
  console.error("💥 SCANNER CRASHED:", err.message);
});
