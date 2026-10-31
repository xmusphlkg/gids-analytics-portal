import { corsHeaders, ensureSchema, readGeo } from "../_lib/db.js";

function json(body, headers, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin");
  return new Response(null, { status: 204, headers: corsHeaders(context.env, origin, "GET, OPTIONS") });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");
  const headers = corsHeaders(env, origin, "GET, OPTIONS");
  const geo = readGeo(request);
  const viewer = {
    country: geo.country,
    city: geo.city,
    region: geo.region,
    colo: geo.colo,
    asn: geo.asn,
    latitude: geo.lat,
    longitude: geo.lng,
  };

  if (!env.GID_DB) {
    return json({ ok: false, configured: false, storageEngine: "none", viewer, error: "GID_DB is not bound" }, headers, 503);
  }

  try {
    await ensureSchema(env.GID_DB);
    const db = env.GID_DB;
    const since = Date.now() - 5 * 60 * 1000;
    const metrics = await db.prepare(`SELECT total_pv, total_uv, filtered_bots FROM global_metrics WHERE id = 1`).first();
    const online = await db.prepare(`SELECT COUNT(*) AS cnt FROM unique_visitors WHERE last_seen >= ?`).bind(since).first();
    const countriesRes = await db.prepare(`SELECT country, pv, uv, last_city, lat, lng FROM country_stats ORDER BY pv DESC LIMIT 30`).all();
    const citiesRes = await db.prepare(`SELECT country, city, lat, lng, pv, last_ts FROM city_nodes ORDER BY pv DESC LIMIT 60`).all();
    const pagesRes = await db.prepare(`SELECT path, title, pv FROM page_stats ORDER BY pv DESC LIMIT 25`).all();
    const logsRes = await db.prepare(`SELECT ts, country, city, region, colo, asn, lat, lng, path, title, referrer, is_new_uv, is_bot FROM access_logs ORDER BY ts DESC LIMIT 40`).all();

    const countries = {};
    for (const row of countriesRes.results || []) {
      countries[row.country] = { pv: row.pv, uv: row.uv, lastCity: row.last_city, lat: row.lat, lng: row.lng };
    }

    const totalPV = metrics?.total_pv || 0;
    const totalUV = metrics?.total_uv || 0;
    const filteredBots = metrics?.filtered_bots || 0;

    return json({
      ok: true,
      configured: true,
      storageEngine: "d1",
      empty: totalPV === 0 && totalUV === 0 && filteredBots === 0,
      viewer,
      onlineCount: online?.cnt || 0,
      totalPV,
      totalUV,
      filteredBots,
      countries,
      cityNodes: (citiesRes.results || []).map((row) => ({
        country: row.country,
        city: row.city,
        lat: row.lat,
        lng: row.lng,
        pv: row.pv,
        lastTs: row.last_ts,
      })),
      pages: (pagesRes.results || []).map((row) => ({ path: row.path, title: row.title, pv: row.pv })),
      recentLogs: (logsRes.results || []).map((row) => ({
        ts: row.ts,
        country: row.country,
        city: row.city,
        region: row.region,
        colo: row.colo,
        asn: row.asn,
        lat: row.lat,
        lng: row.lng,
        path: row.path,
        title: row.title,
        referrer: row.referrer,
        isNewUV: Boolean(row.is_new_uv),
        isBot: Boolean(row.is_bot),
      })),
    }, headers);
  } catch (err) {
    return json({ ok: false, configured: true, storageEngine: "d1", viewer, error: err.message }, headers, 500);
  }
}
