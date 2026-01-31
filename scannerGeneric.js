import fetch from "node-fetch";
import fs from "fs";
const configPath = process.argv[2];
const config = (await import(`./configs/${configPath}`)).default;

const {
    MAX_HOURS_TO_CLOSE,
    MIN_PROBABILITY,
    MAX_PROBABILITY,
    MIN_LIQUIDITY_USD,
} = config.SCANNER;

const OUTPUT_FILE = `scanner-output-${config.NAME}.json`;


// ================= UTILS =================
function hoursUntil(iso) {
    return (new Date(iso).getTime() - Date.now()) / 36e5;
}

async function fetchMarketBySlug(slug) {
    const res = await fetch(
        `https://gamma-api.polymarket.com/markets?slug=${slug}`
    );
    if (!res.ok) throw new Error("Market fetch failed");
    const data = await res.json();
    return data[0];
}

async function fetchOrderbook(tokenId) {
    const res = await fetch(
        `https://clob.polymarket.com/book?token_id=${tokenId}`
    );
    if (!res.ok) throw new Error("Orderbook fetch failed");
    return res.json();
}

// ================= MAIN =================
async function scan() {
    const discovery = JSON.parse(
        fs.readFileSync("./discovery-output.json", "utf-8")
    );

    if (!Array.isArray(discovery.events)) {
        console.log("❌ discovery-output.json has no events");
        return;
    }

    console.log(
        `\n[${new Date().toLocaleTimeString()}] Scanning ${discovery.events.length} events…\n`
    );

    const results = [];

    for (const event of discovery.events) {
        const hrs = hoursUntil(event.endDate);
        if (hrs <= 0 || hrs > MAX_HOURS_TO_CLOSE) continue;

        for (const m of event.markets) {

            // ⏱️ Skip 15-minute markets
            if (m.slug.includes("15m")) {
                console.log(`⏭️  Skipping 15m market: ${m.slug}\n`);
                continue;
            }

            console.log(`🔍 ${m.slug}`);

            let market;
            try {
                market = await fetchMarketBySlug(m.slug);
                if (!market) {
                    console.log(`⚠️ missing market: ${m.slug}`);
                    continue;
                }

            } catch {
                console.log("⚠️  Market fetch failed\n");
                continue;
            }

            if (!market.outcomePrices || !market.clobTokenIds) {
                console.log("⚠️  Missing pricing fields\n");
                continue;
            }

            let prices, tokens;
            try {
                prices = JSON.parse(market.outcomePrices).map(Number);
                tokens = JSON.parse(market.clobTokenIds);
            } catch {
                console.log("⚠️  JSON parse failed\n");
                continue;
            }

            if (prices.length < 1 || tokens.length !== 2) continue;

            const SIDES = [
                { name: "YES", index: 0 },
                { name: "NO", index: 1 }
            ];

            for (const side of SIDES) {
                // ✅ Correct probability definition
                const prob =
                    side.name === "YES"
                        ? prices[0]
                        : 1 - prices[0];

                if (prob < MIN_PROBABILITY) continue;
                if (prob > MAX_PROBABILITY) continue;

                let book;
                try {
                    book = await fetchOrderbook(tokens[side.index]);
                } catch {
                    console.log(`⚠️  ${side.name} orderbook fetch failed\n`);
                    continue;
                }

                if (!book.asks || book.asks.length === 0) {
                    console.log(`⚠️  ${side.name} no asks\n`);
                    continue;
                }

                const bestAsk = Math.min(...book.asks.map(a => Number(a.price)));
                const samePrice = book.asks.filter(
                    a => Number(a.price) === bestAsk
                );

                const size = samePrice.reduce(
                    (s, a) => s + Number(a.size),
                    0
                );

                const liquidity = bestAsk * size;
                if (liquidity < MIN_LIQUIDITY_USD) continue;

                // ✅ NEW: execution sanity check
                if (bestAsk < MIN_PROBABILITY || bestAsk > MAX_PROBABILITY) {
                    console.log(
                        `⛔ ${side.name} | Ask ${bestAsk.toFixed(3)} outside [0.80, 0.96]\n`
                    );
                    continue;
                }


                console.log(
                    `✅ ${side.name} | Prob ${prob.toFixed(3)} | Ask ${bestAsk} | Liquidity $${liquidity.toFixed(2)}\n`
                );

                results.push({
                    slug: m.slug,
                    eventSlug: event.slug,
                    marketSlug: m.slug,
                    marketId: market.id,
                    side: side.name,
                    endDate: market.endDate,
                    hoursToClose: Number(hrs.toFixed(2)),
                    probability: prob,
                    bestAsk,
                    askSize: Number(size.toFixed(2)),
                    liquidityUSD: Number(liquidity.toFixed(2)),
                    tokenId: tokens[side.index]
                });
            }
        }
    }

    fs.writeFileSync(
        OUTPUT_FILE,
        JSON.stringify(
            {
                timestamp: new Date().toISOString(),
                markets: results
            },
            null,
            2
        )
    );

    console.log(`🏁 Scan complete. Valid opportunities: ${results.length}`);
    console.log("📁 Saved to scanner-output.json\n");
}

scan().catch(err => {
    console.error("💥 SCANNER CRASHED:", err.message);
});
