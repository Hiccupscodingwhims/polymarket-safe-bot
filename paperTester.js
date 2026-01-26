import fs from "fs";

// ================= CONFIG =================
const TOTAL_BUDGET = 50;     // fake wallet
const FEE_RATE = 0.01;
const RESOLUTION_POLL_INTERVAL = 2 * 60 * 1000; // 2 minutes
const CSV_FILE = "./paper-trades.csv";
// 1% fee

function ensureCsvHeader() {
    if (!fs.existsSync(CSV_FILE)) {
        const header =
            "trade_date,slug,side,entry_price,size,cost," +
            "hours_to_close_at_entry,trade_bought_timestamp," +
            "resolution,trade_resolved_timestamp,payout,pnl_no_fees,pnl_with_fees\n";

        fs.writeFileSync(CSV_FILE, header);
    }
}

function appendCsvRow(row) {
    fs.appendFileSync(CSV_FILE, row + "\n");
}

ensureCsvHeader();


// ================= WALLET =================
const wallet = {
    startingBalance: TOTAL_BUDGET,
    balance: TOTAL_BUDGET,
    positions: []
};

// ================= LOAD SCANNER OUTPUT =================
const raw = fs.readFileSync("./scanner-output.json", "utf-8");
const data = JSON.parse(raw);

const markets = data.markets ?? [];

if (markets.length === 0) {
    console.log("❌ No eligible markets from scanner. Exiting.\n");
    process.exit(0);
}

// ================= ALLOCATION =================
// IMPORTANT: per QUESTION, equal split
const allocationPerMarket = TOTAL_BUDGET / markets.length;

console.log(`\n📦 Total Budget: $${wallet.balance.toFixed(2)}`);
console.log(`📊 Markets: ${markets.length}`);
console.log(`💰 Allocation per market: $${allocationPerMarket.toFixed(2)}\n`);

// ================= EXECUTION (FAKE FILLS) =================
for (const m of markets) {
    const price = Number(m.bestAsk);
    const availableSize = Number(m.askSize);

    if (!price || !availableSize) continue;

    const maxAffordableSize = allocationPerMarket / price;
    const fillSize = Math.min(maxAffordableSize, availableSize);

    if (fillSize <= 0) continue;

    const cost = fillSize * price;
    wallet.balance -= cost;

    wallet.positions.push({
        slug: m.slug,
        marketId: m.marketId,
        side: m.side,
        entryPrice: price,
        size: fillSize,
        cost,
        boughtAt: new Date().toISOString(),
        hoursToCloseAtEntry: m.hoursToClose,   // ✅ NEW
        resolved: false
    });

    console.log(
        `🧾 ${m.slug}\n` +
        `   Side: ${m.side}\n` +
        `   Price: ${price}\n` +
        `   Size Bought: ${fillSize.toFixed(2)}\n` +
        `   Cost: $${cost.toFixed(2)}\n` +
        `   ⏳ Hours to close: ${m.hoursToClose}\n`
    );
}


// ================= RESOLUTION (ASSUME ALL YES) =================
async function fetchMarketById(id) {
    const res = await fetch(`https://gamma-api.polymarket.com/markets?id=${id}`);
    if (!res.ok) throw new Error("Resolution fetch failed");
    const data = await res.json();
    return data[0];
}

async function watchResolutions() {
    console.log("\n⏳ Watching market resolutions...\n");

    const interval = setInterval(async () => {
        for (const p of wallet.positions) {
            if (p.resolved) continue;

            let market;
            try {
                market = await fetchMarketById(p.marketId);
            } catch {
                continue;
            }

            if (!market.closed) continue;

            const prices = JSON.parse(market.outcomePrices);
            let resolution;

            if (prices[0] === "1") resolution = "YES";
            else if (prices[1] === "1") resolution = "NO";
            else continue; // not finalized yet

            const resolvedAt = new Date().toISOString();

            let payout = 0;

            if (
                (p.side === "YES" && resolution === "YES") ||
                (p.side === "NO" && resolution === "NO")
            ) {
                payout = p.size * 1.0;
            }


            const fee = payout * FEE_RATE;
            const pnlNoFees = payout - p.cost;
            const pnlWithFees = payout - fee - p.cost;

            wallet.balance += payout;
            p.resolved = true;

            appendCsvRow([
                new Date().toISOString().split("T")[0],
                p.slug,
                p.side,
                p.strike,
                p.entryPrice,
                p.size.toFixed(4),
                p.cost.toFixed(2),
                p.hoursToCloseAtEntry,
                p.boughtAt,
                resolution,
                resolvedAt,
                payout.toFixed(2),
                pnlNoFees.toFixed(2),
                pnlWithFees.toFixed(2)
            ].join(","));

            console.log(
                `✅ RESOLVED ${p.slug}\n` +
                `   Side: ${p.side}\n` +
                `   Result: ${resolution}\n` +
                `   P&L (no fees): $${pnlNoFees.toFixed(2)}\n` +
                `   P&L (with fees): $${pnlWithFees.toFixed(2)}\n`
            );

        }

        const unresolved = wallet.positions.some(p => !p.resolved);
        if (!unresolved) {
            clearInterval(interval);
            console.log("\n🏁 All markets resolved. Paper trading complete.\n");
        }
    }, RESOLUTION_POLL_INTERVAL);
}
watchResolutions().catch(err => {
    console.error("💥 RESOLUTION WATCHER CRASHED:", err.message);
});


