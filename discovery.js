import fetch from "node-fetch";
import fs from "fs";

// ================= CONFIG =================
const LIMIT = 100;                     // max allowed by API
const OUTPUT_FILE = "./discovery-output.json";

// ================= UTILS =================
async function fetchEvents(offset) {
  const url =
    `https://gamma-api.polymarket.com/events` +
    `?order=id&ascending=false&closed=false` +
    `&limit=${LIMIT}&offset=${offset}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Event fetch failed @ offset ${offset}`);
  return res.json();
}

// ================= DISCOVERY =================
async function discover() {
  console.log(
    `\n[${new Date().toLocaleTimeString()}] Discovering ALL active events…\n`
  );

  const discovered = [];
  let offset = 0;
  let page = 0;

  while (true) {
    let events;

    try {
      events = await fetchEvents(offset);
    } catch (err) {
      console.log("⚠️  Failed to fetch events, stopping");
      break;
    }

    if (!Array.isArray(events) || events.length === 0) {
      console.log("ℹ️  No more events from API");
      break;
    }

    console.log(
      `📥 Page ${page + 1} | Events fetched: ${events.length} | Total so far: ${discovered.length}`
    );

    for (const ev of events) {
      if (!ev?.id || !ev?.slug || !ev?.endDate) continue;
      if (!Array.isArray(ev.markets) || ev.markets.length === 0) continue;

      const markets = ev.markets
        .filter(m => m?.id && m?.slug)
        .map(m => ({
          id: m.id,
          slug: m.slug
        }));

      if (markets.length === 0) continue;

      discovered.push({
        eventId: ev.id,
        slug: ev.slug,
        title: ev.title ?? "",
        endDate: ev.endDate,
        markets
      });
    }

    offset += LIMIT;
    page++;
  }

  const output = {
    timestamp: new Date().toISOString(),
    totalEvents: discovered.length,
    events: discovered
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log("\n✅ Discovery complete");
  console.log(`📦 Total events discovered: ${discovered.length}`);
  console.log(`📁 Saved to ${OUTPUT_FILE}\n`);
}

// ================= RUN =================
discover().catch(err => {
  console.error("💥 DISCOVERY CRASHED:", err.message);
});
