/**
 * Cloudflare Pages Function: GET /api/stats
 * 对外输出全球统计数据（自动适配 D1 数据库或 KV 存储，并返回当前访问者自身的边缘位置）
 */

function isAllowedOrigin(requestOrigin, allowedOriginEnv) {
  if (!requestOrigin) return true;
  if (allowedOriginEnv === "*") return true;
  try {
    const url = new URL(requestOrigin);
    const host = url.hostname.toLowerCase();
    if (
      host === "globalinfectiousdisease.com" ||
      host.endsWith(".globalinfectiousdisease.com") ||
      host.endsWith(".pages.dev") ||
      host === "localhost" ||
      host === "127.0.0.1"
    ) {
      return true;
    }
  } catch (e) {}
  return requestOrigin === allowedOriginEnv;
}

function getCorsHeaders(env, requestOrigin) {
  const allowed = env.ALLOWED_ORIGIN || "https://globalinfectiousdisease.com";
  const allowOriginHeader = isAllowedOrigin(requestOrigin, allowed) ? (requestOrigin || "*") : allowed;
  return {
    "Access-Control-Allow-Origin": allowOriginHeader,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, max-age=0",
  };
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(context.env, origin),
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");
  const corsHeaders = getCorsHeaders(env, origin);
  const cf = request.cf || {};

  const viewer = {
    country: (cf.country && cf.country !== "XX") ? cf.country : "US",
    city: cf.city || cf.region || "Local Edge",
    region: cf.region || "",
    colo: cf.colo || "CF",
    asn: cf.asn ? `AS${cf.asn}` : "",
    latitude: cf.latitude ? parseFloat(cf.latitude) : 38.9072,
    longitude: cf.longitude ? parseFloat(cf.longitude) : -77.0369,
  };

  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;

  // 1. 优先从 D1 SQL 数据库读取
  if (env.GID_DB) {
    try {
      const metrics = await env.GID_DB.prepare(`SELECT total_pv, total_uv, filtered_bots FROM global_metrics WHERE id = 1`).first();
      if (!metrics || (metrics.total_pv === 0 && metrics.filtered_bots === 0)) {
        return new Response(
          JSON.stringify({ ok: true, storageEngine: "D1 (SQL)", configured: true, empty: true, viewer }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const onlineRow = await env.GID_DB.prepare(`SELECT COUNT(*) as cnt FROM unique_visitors WHERE last_seen >= ?`).bind(fiveMinAgo).first();
      const countriesRes = await env.GID_DB.prepare(`SELECT country, pv, uv, last_city, lat, lng FROM country_stats ORDER BY pv DESC LIMIT 30`).all();
      const citiesRes = await env.GID_DB.prepare(`SELECT country, city, lat, lng, pv, last_ts FROM city_nodes ORDER BY pv DESC LIMIT 60`).all();
      const pagesRes = await env.GID_DB.prepare(`SELECT path, title, pv FROM page_stats ORDER BY pv DESC LIMIT 15`).all();
      const logsRes = await env.GID_DB.prepare(`SELECT ts, country, city, region, colo, asn, lat, lng, path, title, referrer, is_new_uv, is_bot FROM access_logs ORDER BY ts DESC LIMIT 35`).all();

      const countries = {};
      for (const r of (countriesRes.results || [])) {
        countries[r.country] = { pv: r.pv, uv: r.uv, lastCity: r.last_city, lat: r.lat, lng: r.lng };
      }

      const cityNodes = (citiesRes.results || []).map(r => ({
        country: r.country, city: r.city, lat: r.lat, lng: r.lng, pv: r.pv, lastTs: r.last_ts
      }));

      const pages = {};
      for (const p of (pagesRes.results || [])) {
        pages[p.path] = p.pv;
      }

      const recentLogs = (logsRes.results || []).map(l => ({
        ts: l.ts,
        country: l.country,
        city: l.city,
        region: l.region,
        colo: l.colo,
        asn: l.asn,
        lat: l.lat,
        lng: l.lng,
        path: l.path,
        title: l.title,
        referrer: l.referrer,
        isNewUV: Boolean(l.is_new_uv),
        isBot: Boolean(l.is_bot),
      }));

      return new Response(
        JSON.stringify({
          ok: true,
          storageEngine: "Cloudflare D1 (Atomic SQL)",
          configured: true,
          empty: false,
          viewer,
          onlineCount: Math.max(1, onlineRow ? onlineRow.cnt : 1),
          totalPV: metrics.total_pv || 0,
          totalUV: metrics.total_uv || 0,
          filteredBots: metrics.filtered_bots || 0,
          countries,
          cityNodes,
          pages,
          recentLogs,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (e) {
      // 表尚未初始化时走回退演示
      return new Response(
        JSON.stringify({ ok: true, storageEngine: "D1 (Initializing)", configured: true, empty: true, viewer }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // 2. 兼容从 KV 读取
  if (env.GID_STATS_KV) {
    try {
      const rawState = (await env.GID_STATS_KV.get("GID_SUMMARY_V2", { type: "json" })) ||
                       (await env.GID_STATS_KV.get("GID_SUMMARY_V1", { type: "json" }));
      if (!rawState) {
        return new Response(
          JSON.stringify({ ok: true, storageEngine: "Workers KV", configured: true, empty: true, viewer }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const activeSessions = rawState.activeSessions || {};
      for (const [vid, s] of Object.entries(activeSessions)) {
        if (now - s.ts > 5 * 60 * 1000) delete activeSessions[vid];
      }

      const cityNodes = rawState.cityNodes
        ? Object.values(rawState.cityNodes)
        : Object.entries(rawState.countries || {}).map(([c, info]) => ({
            country: c, city: info.lastCity || c, lat: info.lat, lng: info.lng, pv: info.pv
          }));

      return new Response(
        JSON.stringify({
          ok: true,
          storageEngine: "Cloudflare Workers KV",
          configured: true,
          empty: false,
          viewer,
          onlineCount: Math.max(1, Object.keys(activeSessions).length),
          totalPV: rawState.totalPV || 0,
          totalUV: rawState.totalUV || 0,
          filteredBots: rawState.filteredBots || 0,
          countries: rawState.countries || {},
          cityNodes,
          pages: rawState.pages || {},
          recentLogs: rawState.recentLogs || [],
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message, viewer }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // 3. 尚未绑定 D1 或 KV 时
  return new Response(
    JSON.stringify({
      ok: true,
      storageEngine: "Unconfigured (Demo Fallback)",
      configured: false,
      viewer,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
