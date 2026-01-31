import fs from "fs";
import fetch from "node-fetch";
import express from 'express';

// ================= CONFIG =================
const FEE_RATE = 0.01;
const RESOLUTION_POLL_INTERVAL = 1 * 60 * 1000; // 1 minute

const configPath = process.argv[2];
const config = (await import(`./configs/${configPath}`)).default;

const {
  TOTAL_BUDGET,
  STOP_PROB_DROP
} = config.TRADER;

const SCANNER_INPUT =
  `scanner-output-${config.NAME}.json`;

const CSV_FILE =
  `paper-${config.NAME}.csv`;


// ================= CONTROL SERVER =================
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/snapshot", (req, res) => {
    exportSnapshot();
    res.send("📸 Snapshot exported");
});

app.get("/status", (req, res) => {
    res.json({
        balance: wallet.balance,
        positions: wallet.positions.length
    });
});

app.listen(PORT, () => {
    console.log(`🎛 Control server running on port ${PORT}`);
});

// ================= CSV =================
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

const SNAPSHOT_FILE = `./paper-trades-snapshot-${config.NAME}.csv`;

function exportSnapshot() {
    const header =
        "slug,side,entry_price,size_remaining,cost_remaining," +
        "resolved,resolution,resolvedAt,payout,pnlNoFees,pnlWithFees\n";

    const rows = wallet.positions
        .filter(p => p.resolved)
        .map(p =>
            [
                p.slug,
                p.side,
                p.entryPrice,
                p.size.toFixed(4),
                p.cost.toFixed(2),
                p.resolved,
                p.resolution ?? "",
                p.resolvedAt ?? "",
                p.payout?.toFixed(2) ?? "",
                p.pnlNoFees?.toFixed(2) ?? "",
                p.pnlWithFees?.toFixed(2) ?? ""
            ].join(",")
        );

    fs.writeFileSync(
        SNAPSHOT_FILE,
        header + rows.join("\n")
    );

    const totalPnl = wallet.positions
        .filter(p => p.resolved && p.pnlWithFees !== undefined)
        .reduce((sum,p)=>sum+p.pnlWithFees,0);

    console.log(
        `📸 Snapshot exported (${rows.length} trades)` +
        ` | Realized P&L: $${totalPnl.toFixed(2)} → ${SNAPSHOT_FILE}`
    );
}


// ================= WALLET =================
const wallet = {
    startingBalance: TOTAL_BUDGET,
    balance: TOTAL_BUDGET,
    positions: []
};

// ================= LOAD SCANNER OUTPUT =================
const raw = fs.readFileSync(SCANNER_INPUT, "utf-8");
const data = JSON.parse(raw);
const markets = data.markets ?? [];

if (markets.length === 0) {
    console.log("❌ No eligible markets from scanner. Exiting.\n");
    process.exit(0);
}

// ================= ALLOCATION =================
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
        tokenId: m.tokenId,                  // ✅ added
        entryProbability: m.probability,     // ✅ added
        entryPrice: price,
        size: fillSize,
        cost,
        boughtAt: new Date().toISOString(),
        hoursToCloseAtEntry: m.hoursToClose,
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

// ================= RESOLUTION =================
async function fetchMarketById(id) {
    const res = await fetch(`https://gamma-api.polymarket.com/markets?id=${id}`);
    if (!res.ok) throw new Error("Resolution fetch failed");
    const data = await res.json();
    return data[0];
}

async function fetchOrderbook(tokenId) {
    const res = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`);
    if (!res.ok) throw new Error("Orderbook fetch failed");
    return res.json();
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

            // ================= STOP LOSS (ADDED, NON-DESTRUCTIVE) =================
            try {
                const prices = JSON.parse(market.outcomePrices);
                const currentProb =
                    p.side === "YES"
                        ? Number(prices[0])
                        : 1 - Number(prices[0]);

                const probDrop = p.entryProbability - currentProb;

                if (probDrop >= STOP_PROB_DROP) {
                    console.log(
                        `🛑 STOP CHECK ${p.slug}\n` +
                        `   Entry Prob: ${p.entryProbability.toFixed(3)}\n` +
                        `   Current Prob: ${currentProb.toFixed(3)}\n` +
                        `   Drop: ${probDrop.toFixed(3)}`
                    );

                    const book = await fetchOrderbook(p.tokenId);
                    if (!book.bids || book.bids.length === 0) {
                        console.log(`⚠️  STOP: no bids available\n`);
                        continue;
                    }

                    const bestBid = Math.max(...book.bids.map(b => Number(b.price)));
                    const bidsAtBest = book.bids.filter(b => Number(b.price) === bestBid);
                    const bidSize = bidsAtBest.reduce((s, b) => s + Number(b.size), 0);

                    const exitSize = Math.min(p.size, bidSize);
                    if (exitSize <= 0) continue;

                    const payout = exitSize * bestBid;
                    const costPortion = (exitSize / p.size) * p.cost;

                    wallet.balance += payout;
                    p.size -= exitSize;
                    p.cost -= costPortion;

                    appendCsvRow([
                        new Date().toISOString().split("T")[0],
                        p.slug,
                        p.side,
                        p.entryPrice,
                        exitSize.toFixed(4),
                        costPortion.toFixed(2),
                        p.hoursToCloseAtEntry,
                        p.boughtAt,
                        "STOP_LOSS",
                        new Date().toISOString(),
                        payout.toFixed(2),
                        (payout - costPortion).toFixed(2),
                        (payout - costPortion - payout * FEE_RATE).toFixed(2)
                    ].join(","));

                    console.log(
                        `🛑 STOP EXIT ${p.slug}\n` +
                        `   Exited Size: ${exitSize.toFixed(4)} @ ${bestBid}\n` +
                        `   Remaining Size: ${p.size.toFixed(4)}\n`
                    );
                    p.resolution = "STOP_LOSS";
                    p.resolvedAt = new Date().toISOString();
                    p.payout = payout;
                    p.pnlNoFees = payout - costPortion;
                    p.pnlWithFees = payout - costPortion - payout * FEE_RATE;


                    if (p.size <= 0) p.resolved = true;
                    continue;
                }
            } catch { }

            // ================= ORIGINAL RESOLUTION LOGIC (UNCHANGED) =================
            if (!market.closed) continue;

            const prices = JSON.parse(market.outcomePrices);
            let resolution;

            if (prices[0] === "1") resolution = "YES";
            else if (prices[1] === "1") resolution = "NO";
            else continue;

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
            p.resolution = resolution;
            p.resolvedAt = resolvedAt;
            p.payout = payout;
            p.pnlNoFees = pnlNoFees;
            p.pnlWithFees = pnlWithFees;

            p.resolved = true;

            appendCsvRow([
                new Date().toISOString().split("T")[0],
                p.slug,
                p.side,
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
            dumpCsvToLogs();
        }
    }, RESOLUTION_POLL_INTERVAL);
}

watchResolutions().catch(err => {
    console.error("💥 RESOLUTION WATCHER CRASHED:", err.message);
});

// ================= CSV DUMP =================
function dumpCsvToLogs() {
    if (!fs.existsSync(CSV_FILE)) {
        console.log("❌ CSV file not found");
        return;
    }

    const csv = fs.readFileSync(CSV_FILE, "utf-8");
    console.log("\n===CSV_START===");
    console.log(csv);
    console.log("===CSV_END===\n");
}

process.stdin.setEncoding("utf8");

process.stdin.on("data", (input) => {
    const cmd = input.trim().toLowerCase();

    if (cmd === "snapshot") {
        exportSnapshot();
    }
});

