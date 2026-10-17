/**
 * netlify/functions/winners.mjs
 *
 * Month-by-month results for the "Monthly Winners" slide.
 *
 *   GET /api/winners  -> { ok:true, months:[{ month, label, current, divisions }] }
 *
 * Runs the same ServiceTitan report as /api/feed, once per month from
 * board-config.json -> winners.startMonth up to the current month, and
 * returns each tech's revenue and total sold grouped by board. The board
 * page picks the #1 per division itself, so roster pins and exclusions from
 * the admin page apply exactly as they do on the live slides.
 *
 * Results are cached in Netlify Blobs. Past months are not locked — they're
 * re-pulled every PAST_TTL so late adjustments in ServiceTitan still land.
 * ServiceTitan allows 5 calls of the same report per minute, so each request
 * refreshes at most MAX_REFRESH months and serves the rest from cache.
 */

import { getStore } from "@netlify/blobs";
import feed from "./board-feed.js";
import cfg from "../../config/board-config.json";

export const config = { path: "/api/winners" };

const TZ = cfg.timezone || "America/Chicago";
const CURRENT_TTL = 15 * 60 * 1000;     // current month: same cadence as the board
const PAST_TTL = 6 * 60 * 60 * 1000;    // past months: re-check a few times a day
const MAX_REFRESH = 3;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    }
  });

function todayParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  const today = `${get("year")}-${get("month")}-${get("day")}`;
  return { today, month: today.slice(0, 7) };
}

/** "2026-07" .. "2026-10" inclusive */
function monthList(start, end) {
  const out = [];
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

function monthBounds(ym, today) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${ym}-${String(last).padStart(2, "0")}`;
  return { from: `${ym}-01`, to: end < today ? end : today };
}

function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-US", {
    month: "long", year: "numeric", timeZone: "UTC"
  });
}

/** Keep only what the slide needs: { service: { Name: { revenue, sales } }, ... } */
function groupTechs(techs) {
  const divisions = { service: {}, sales: {}, install: {} };
  for (const t of techs) {
    const board = feed.boardFor(t);
    if (!board) continue;
    (divisions[board] = divisions[board] || {})[t.name] = {
      revenue: t.revenue,
      sales: t.totalSales
    };
  }
  return divisions;
}

export default async () => {
  try {
    const w = cfg.winners || {};
    const { today, month: thisMonth } = todayParts();
    const start = w.startMonth && w.startMonth <= thisMonth ? w.startMonth : thisMonth;
    const months = monthList(start, thisMonth).slice(-(w.maxMonths || 12));

    const store = getStore("board-winners");
    const cached = await Promise.all(months.map((m) => store.get(m, { type: "json" })));

    const now = Date.now();
    const ttl = (m) => (m === thisMonth ? CURRENT_TTL : PAST_TTL);
    const stale = months
      .map((m, i) => ({ m, i, c: cached[i] }))
      .filter(({ m, c }) => !c || now - c.fetchedAt > ttl(m))
      // never-fetched first, then the current month, then oldest data
      .sort((a, b) =>
        (a.c ? 1 : 0) - (b.c ? 1 : 0) ||
        (b.m === thisMonth) - (a.m === thisMonth) ||
        (a.c ? a.c.fetchedAt : 0) - (b.c ? b.c.fetchedAt : 0)
      );

    const errors = [];
    for (const s of stale.slice(0, MAX_REFRESH)) {
      try {
        const { techs } = await feed.fetchTechs(monthBounds(s.m, today));
        const entry = { month: s.m, fetchedAt: now, divisions: groupTechs(techs) };
        await store.setJSON(s.m, entry);
        cached[s.i] = entry;
      } catch (err) {
        errors.push(`${s.m}: ${err.message}`);
        // Rate limited: stop here so we don't burn calls the live feed needs.
        if (/\(429\)/.test(err.message)) break;
      }
    }

    return json({
      ok: true,
      generatedAt: new Date().toISOString(),
      currentMonth: thisMonth,
      pending: cached.filter((c) => !c).length,
      errors,
      months: months.map((m, i) => ({
        month: m,
        label: monthLabel(m),
        current: m === thisMonth,
        fetchedAt: cached[i] ? cached[i].fetchedAt : null,
        divisions: cached[i] ? cached[i].divisions : null
      }))
    });
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err) }, 500);
  }
};
