import fetch from "node-fetch";
import fs from "fs";

// ================= CONFIG =================
const MAX_HOURS_TO_CLOSE = 4;
const MIN_PROBABILITY = 0.80;
const MAX_PROBABILITY = 0.96;
const MIN_LIQUIDITY_USD = 1;

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
            console.log(`🔍 ${m.slug}`);

            let market;
            try {
                market = await fetchMarketBySlug(m.slug);
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
                prices = JSON.parse(market.outcomePrices);
                tokens = JSON.parse(market.clobTokenIds);
            } catch {
                console.log("⚠️  JSON parse failed\n");
                continue;
            }

            if (prices.length !== 2 || tokens.length !== 2) continue;

            const SIDES = [
                { name: "YES", index: 0 },
                { name: "NO", index: 1 }
            ];

            for (const side of SIDES) {
                const prob = Number(prices[side.index]);

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

                // LOWEST ask (absolute best price)
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

                console.log(
                    `✅ ${side.name} | Ask ${bestAsk} | Liquidity $${liquidity.toFixed(2)}\n`
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
        "./scanner-output.json",
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
