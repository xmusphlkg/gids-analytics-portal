import { classifyBot, corsHeaders, ensureSchema, hashVisitor, isAllowedOrigin, readGeo } from "../_lib/db.js";

const PIXEL = new Uint8Array([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33, 249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
]);

function json(body, headers, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin");
  return new Response(null, { status: 204, headers: corsHeaders(context.env, origin, "GET, POST, OPTIONS") });
}

async function record(context, payload, isPixel) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");
  const headers = corsHeaders(env, origin, "GET, POST, OPTIONS");
  if (origin && !isAllowedOrigin(origin, env.ALLOWED_ORIGIN)) {
    return json({ ok: false, error: "origin" }, headers, 403);
  }
  if (!env.GID_DB) {
    return json({ ok: false, error: "GID_DB is not bound" }, headers, 503);
  }

  const geo = readGeo(request);
  const ua = request.headers.get("User-Agent") || "";
  const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
  const isBot = classifyBot(request, payload, geo, isPixel);
  const path = String(payload.path || "/").slice(0, 180);
  const title = String(payload.title || "GIDS").slice(0, 180);
  const referrer = String(payload.referrer || "Direct").slice(0, 180);
  const now = Date.now();
  const visitorHash = await hashVisitor(ip, ua, geo.country);
  const cityKey = `${geo.country}:${geo.city || geo.region || "—"}`;

  await ensureSchema(env.GID_DB);
  const db = env.GID_DB;
  const dupe = await db.prepare(`SELECT id FROM access_logs WHERE visitor_hash = ? AND path = ? AND ts > ? LIMIT 1`).bind(visitorHash, path, now - 15000).first();
  if (dupe) {
    if (isPixel) return new Response(PIXEL, { status: 200, headers: { ...headers, "Content-Type": "image/gif" } });
    return json({ ok: true, engine: "d1", deduped: true }, headers);
  }
  const day = new Date(now).toISOString().slice(0, 10);

  if (isBot) {
    await db.batch([
      db.prepare(`UPDATE global_metrics SET filtered_bots = filtered_bots + 1 WHERE id = 1`),
      db.prepare(`INSERT INTO access_logs (ts, visitor_hash, country, city, region, colo, asn, lat, lng, path, title, referrer, is_new_uv, is_bot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`).bind(
        now, visitorHash, geo.country, geo.city, geo.region, geo.colo, geo.asn, geo.lat, geo.lng, path, title, referrer
      ),
      db.prepare(`DELETE FROM access_logs WHERE id NOT IN (SELECT id FROM access_logs ORDER BY ts DESC LIMIT 80)`),
    ]);
  } else {
    const existing = await db.prepare(`SELECT visitor_hash FROM unique_visitors WHERE visitor_hash = ?`).bind(visitorHash).first();
    const isNew = existing ? 0 : 1;
    const statements = [
      db.prepare(`UPDATE global_metrics SET total_pv = total_pv + 1, total_uv = total_uv + ? WHERE id = 1`).bind(isNew),
      db.prepare(`INSERT INTO unique_visitors (visitor_hash, first_seen, last_seen, country, city, lat, lng, visits) VALUES (?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT(visitor_hash) DO UPDATE SET last_seen = excluded.last_seen, city = excluded.city, lat = COALESCE(excluded.lat, unique_visitors.lat), lng = COALESCE(excluded.lng, unique_visitors.lng), visits = unique_visitors.visits + 1`).bind(
        visitorHash, now, now, geo.country, geo.city, geo.lat, geo.lng
      ),
      db.prepare(`INSERT INTO country_stats (country, pv, uv, last_city, lat, lng) VALUES (?, 1, ?, ?, ?, ?) ON CONFLICT(country) DO UPDATE SET pv = country_stats.pv + 1, uv = country_stats.uv + ?, last_city = excluded.last_city, lat = COALESCE(excluded.lat, country_stats.lat), lng = COALESCE(excluded.lng, country_stats.lng)`).bind(
        geo.country, isNew, geo.city, geo.lat, geo.lng, isNew
      ),
      db.prepare(`INSERT INTO page_stats (path, title, pv) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET pv = page_stats.pv + 1, title = excluded.title`).bind(path, title),
      db.prepare(`INSERT INTO daily_stats (day, pv, uv) VALUES (?, 1, ?) ON CONFLICT(day) DO UPDATE SET pv = daily_stats.pv + 1, uv = daily_stats.uv + ?`).bind(day, isNew, isNew),
      db.prepare(`INSERT INTO daily_country (day, country, pv, uv) VALUES (?, ?, 1, ?) ON CONFLICT(day, country) DO UPDATE SET pv = daily_country.pv + 1, uv = daily_country.uv + ?`).bind(day, geo.country || "XX", isNew, isNew),
      db.prepare(`INSERT INTO access_logs (ts, visitor_hash, country, city, region, colo, asn, lat, lng, path, title, referrer, is_new_uv, is_bot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`).bind(
        now, visitorHash, geo.country, geo.city, geo.region, geo.colo, geo.asn, geo.lat, geo.lng, path, title, referrer, isNew
      ),
      db.prepare(`DELETE FROM access_logs WHERE id NOT IN (SELECT id FROM access_logs ORDER BY ts DESC LIMIT 80)`),
    ];
    if (geo.lat != null && geo.lng != null) {
      statements.splice(3, 0, db.prepare(`INSERT INTO city_nodes (city_key, country, city, lat, lng, pv, last_ts) VALUES (?, ?, ?, ?, ?, 1, ?) ON CONFLICT(city_key) DO UPDATE SET pv = city_nodes.pv + 1, last_ts = excluded.last_ts, lat = excluded.lat, lng = excluded.lng`).bind(
        cityKey, geo.country, geo.city || geo.region || geo.country, geo.lat, geo.lng, now
      ));
    }
    await db.batch(statements);
  }

  if (isPixel) {
    return new Response(PIXEL, { status: 200, headers: { ...headers, "Content-Type": "image/gif" } });
  }
  return json({ ok: true, engine: "d1", country: geo.country, city: geo.city, isBot }, headers);
}

export async function onRequestPost(context) {
  try {
    const text = await context.request.text();
    let body = {};
    if (text) {
      try { body = JSON.parse(text); } catch (e) { body = {}; }
    }
    return await record(context, body, false);
  } catch (err) {
    const origin = context.request.headers.get("Origin");
    return json({ ok: false, error: err.message }, corsHeaders(context.env, origin, "GET, POST, OPTIONS"), 500);
  }
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    return await record(context, {
      path: url.searchParams.get("path") || "/noscript",
      title: url.searchParams.get("title") || "GIDS",
      referrer: context.request.headers.get("Referer") || "Direct",
    }, true);
  } catch (err) {
    const origin = context.request.headers.get("Origin");
    return json({ ok: false, error: err.message }, corsHeaders(context.env, origin, "GET, POST, OPTIONS"), 500);
  }
}
