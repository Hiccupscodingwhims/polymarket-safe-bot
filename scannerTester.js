import fetch from "node-fetch";
import fs from "fs";

/* ================= CONFIG ================= */
const TOTAL_BUDGET = 50;
const FEE_RATE = 0.01;
const MAX_HOURS_TO_CLOSE = 4;
const MIN_PROBABILITY = 0.80;
const MAX_PROBABILITY = 0.96;
const MIN_LIQUIDITY_USD = 10;
const RESOLUTION_POLL_INTERVAL = 2 * 60 * 1000;
const CSV_FILE = "./paper-trades.csv";

/* ================= CSV ================= */
function ensureCsvHeader() {
  if (!fs.existsSync(CSV_FILE)) {
    fs.writeFileSync(
      CSV_FILE,
      "trade_date,slug,side,entry_price,size,cost,hours_to_close_at_entry,bought_at,resolution,resolved_at,payout,pnl_no_fees,pnl_with_fees\n"
    );
  }
}
function appendCsv(row) {
  fs.appendFileSync(CSV_FILE, row + "\n");
}
ensureCsvHeader();

/* ================= WALLET ================= */
const wallet = {
  balance: TOTAL_BUDGET,
  positions: []
};

/* ================= UTILS ================= */
const hoursUntil = iso =>
  (new Date(iso).getTime() - Date.now()) / 36e5;

async function fetchMarket(slug) {
  const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${slug}`);
  const j = await res.json();
  return j[0];
}

async function fetchBook(tokenId) {
  const res = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`);
  return res.json();
}

/* ================= PAPER TRADE ================= */
function paperTrade(m) {
  const allocation = TOTAL_BUDGET / 5; // cap exposure per batch

  const size = Math.min(allocation / m.price, m.askSize);
  if (size <= 0) return;

  const cost = size * m.price;
  if (wallet.balance < cost) return;

  wallet.balance -= cost;

  wallet.positions.push({
    slug: m.slug,
    marketId: m.marketId,
    side: m.side,
    entryPrice: m.price,
    size,
    cost,
    hoursToClose: m.hoursToClose,
    boughtAt: new Date().toISOString(),
    resolved: false
  });

  console.log(
    `🧾 ${m.slug}\n` +
    `   Side: ${m.side}\n` +
    `   Price: ${m.price}\n` +
    `   Size Bought: ${size.toFixed(2)}\n` +
    `   Cost: $${cost.toFixed(2)}\n` +
    `   ⏳ Hours to close: ${m.hoursToClose.toFixed(2)}\n`
  );
}

/* ================= SCANNER ================= */
async function scanAndTrade(events) {
  for (const ev of events) {
    const hrs = hoursUntil(ev.endDate);
    if (hrs <= 0 || hrs > MAX_HOURS_TO_CLOSE) continue;

    for (const m of ev.markets) {
      const market = await fetchMarket(m.slug);
      if (!market?.outcomePrices || !market?.clobTokenIds) continue;

      const prices = JSON.parse(market.outcomePrices).map(Number);
      const tokens = JSON.parse(market.clobTokenIds);

      for (const side of ["YES", "NO"]) {
        const idx = side === "YES" ? 0 : 1;
        const prob = side === "YES" ? prices[0] : 1 - prices[0];

        if (prob < MIN_PROBABILITY || prob > MAX_PROBABILITY) continue;

        const book = await fetchBook(tokens[idx]);
        if (!book.asks?.length) continue;

        const bestAsk = Math.min(...book.asks.map(a => Number(a.price)));
        const size = book.asks
          .filter(a => Number(a.price) === bestAsk)
          .reduce((s, a) => s + Number(a.size), 0);

        if (bestAsk * size < MIN_LIQUIDITY_USD) continue;

        paperTrade({
          slug: m.slug,
          marketId: market.id,
          side,
          price: bestAsk,
          askSize: size,
          hoursToClose: hrs
        });
      }
    }
  }
}

/* ================= RESOLUTION WATCHER ================= */
async function fetchMarketById(id) {
  const r = await fetch(`https://gamma-api.polymarket.com/markets?id=${id}`);
  return (await r.json())[0];
}

function watchResolutions() {
  setInterval(async () => {
    for (const p of wallet.positions) {
      if (p.resolved) continue;

      const m = await fetchMarketById(p.marketId);
      if (!m?.closed) continue;

      const prices = JSON.parse(m.outcomePrices);
      const result =
        prices[0] === "1" ? "YES" :
        prices[1] === "1" ? "NO" : null;

      if (!result) continue;

      const payout =
        p.side === result ? p.size * 1 : 0;

      const fee = payout * FEE_RATE;
      const pnlNoFees = payout - p.cost;
      const pnlWithFees = pnlNoFees - fee;

      appendCsv([
        new Date().toISOString().split("T")[0],
        p.slug,
        p.side,
        p.entryPrice,
        p.size.toFixed(4),
        p.cost.toFixed(2),
        p.hoursToClose.toFixed(2),
        p.boughtAt,
        result,
        new Date().toISOString(),
        payout.toFixed(2),
        pnlNoFees.toFixed(2),
        pnlWithFees.toFixed(2)
      ].join(","));

      p.resolved = true;

      console.log(
        `✅ RESOLVED ${p.slug}\n` +
        `   Side: ${p.side}\n` +
        `   Result: ${result}\n` +
        `   P&L (no fees): $${pnlNoFees.toFixed(2)}\n` +
        `   P&L (with fees): $${pnlWithFees.toFixed(2)}\n`
      );
    }
  }, RESOLUTION_POLL_INTERVAL);
}

/* ================= BOOT ================= */
(async () => {
  const discovery = JSON.parse(fs.readFileSync("./discovery-output.json", "utf-8"));
  await scanAndTrade(discovery.events);
  watchResolutions();
})();
