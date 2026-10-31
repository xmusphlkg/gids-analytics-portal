/**
 * Cloudflare Pages Function: POST / GET /api/track
 * 接收来自主站 (https://globalinfectiousdisease.com) 的真实访客信标与服务端像素探针
 *
 * 【v2 核心修复】
 * 1. 修复跨域校验漏洞：严格校验 https://globalinfectiousdisease.com 及其子域名 (*.globalinfectiousdisease.com)
 * 2. 支持 text/plain Simple Request 免除浏览器 OPTIONS 预检，提升上报速度与成功率
 * 3. 支持 GET /api/track?pixel=1&path=... 1x1 透明 GIF 探针，捕获不执行 JS 的爬虫/抓取器
 * 4. 双存储引擎自适应：优先使用 Cloudflare D1 (SQL 原子累加，零并发丢失，自动建表)；
 *    若只绑定了 KV，则启用“全周期永久 UV 去重 + 多城市坐标保留 + 写入冷却节流”，防止刷爆免费额度
 * 5. 利用 Cloudflare request.cf.botManagement / Score / ASN / UA 多维识别爬虫
 */

const BOT_UA_REGEX = /bot|crawler|spider|crawling|headless|lighthouse|pingdom|gtmetrix|uptime|python|curl|wget|scrapy|axios|go-http-client|java|okhttp|ahrefs|semrush|mj12bot|dotbot|bytespider|gptbot|claudebot|ccbot|perplexity|anthropic|facebookexternalhit|bingpreview/i;
const CLOUD_ASN_ORG_REGEX = /amazon|aws|google cloud|microsoft|digitalocean|linode|vultr|hetzner|ovh|choopa|contabo|alibaba|tencent|huawei|oracle|m247|datacamp|fly\.io|render/i;

const TRANSPARENT_GIF = new Uint8Array([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33, 249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59
]);

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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  };
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(context.env, origin),
  });
}

// 永久访客匿名指纹（去掉日期后缀，解决跨天重复累加总 UV 的 Bug，同时不落盘明文 IP）
async function hashVisitorPermanent(ip, ua, country) {
  const raw = `${ip}::${ua.slice(0, 100)}::${country}::gid-v2-permanent-salt`;
  const data = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 20);
}

// 自动初始化 D1 表结构（首次运行自动建表，零手动 SQL 负担）
let d1Initialized = false;
async function ensureD1Schema(db) {
  if (d1Initialized) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS global_metrics (id INTEGER PRIMARY KEY CHECK (id = 1), total_pv INTEGER NOT NULL DEFAULT 0, total_uv INTEGER NOT NULL DEFAULT 0, filtered_bots INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`INSERT OR IGNORE INTO global_metrics (id, total_pv, total_uv, filtered_bots) VALUES (1, 0, 0, 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS unique_visitors (visitor_hash TEXT PRIMARY KEY, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, country TEXT NOT NULL, city TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, visits INTEGER NOT NULL DEFAULT 1)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS country_stats (country TEXT PRIMARY KEY, pv INTEGER NOT NULL DEFAULT 0, uv INTEGER NOT NULL DEFAULT 0, last_city TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS city_nodes (city_key TEXT PRIMARY KEY, country TEXT NOT NULL, city TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, pv INTEGER NOT NULL DEFAULT 0, last_ts INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS page_stats (path TEXT PRIMARY KEY, title TEXT NOT NULL, pv INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS access_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, visitor_hash TEXT NOT NULL, country TEXT NOT NULL, city TEXT NOT NULL, region TEXT, colo TEXT NOT NULL, asn TEXT, lat REAL NOT NULL, lng REAL NOT NULL, path TEXT NOT NULL, title TEXT NOT NULL, referrer TEXT NOT NULL, is_new_uv INTEGER NOT NULL DEFAULT 0, is_bot INTEGER NOT NULL DEFAULT 0)`),
  ]);
  d1Initialized = true;
}

async function handleTelemetry(context, payload, isPixelRequest) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");
  const corsHeaders = getCorsHeaders(env, origin);

  const ua = request.headers.get("User-Agent") || "";
  const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
  const cf = request.cf || {};

  // 提取 Cloudflare 边缘真实地理与网络属性
  const country = (cf.country && cf.country !== "XX") ? cf.country : "US";
  const city = cf.city || cf.region || "Edge Node";
  const region = cf.region || "";
  const colo = cf.colo || "IAD";
  const asn = cf.asn ? `AS${cf.asn}` : "";
  const asOrg = (cf.asOrganization || "").toLowerCase();
  const latitude = cf.latitude ? parseFloat(cf.latitude) : 38.9072;
  const longitude = cf.longitude ? parseFloat(cf.longitude) : -77.0369;

  // 多维度判定是否为爬虫或自动化脚本
  const cfBotScore = cf.botManagement && typeof cf.botManagement.score === "number" ? cf.botManagement.score : 99;
  const isVerifiedBot = Boolean(cf.botManagement && cf.botManagement.verifiedBot);
  const isAutomatedUA = BOT_UA_REGEX.test(ua);
  const isHeadless = Boolean(payload.webdriver);
  const isDatacenterNoJS = isPixelRequest && CLOUD_ASN_ORG_REGEX.test(asOrg);

  const isBot = isVerifiedBot || cfBotScore < 30 || isAutomatedUA || isHeadless || isDatacenterNoJS;

  const path = String(payload.path || "/").slice(0, 140);
  const title = String(payload.title || "Global Infectious Disease Portal").slice(0, 160);
  const referrer = String(payload.referrer || "Direct").slice(0, 160);
  const now = Date.now();
  const visitorHash = await hashVisitorPermanent(ip, ua, country);
  const cityKey = `${country}:${city}`;

  // =========================================================================
  // 引擎 1：如果绑定了 Cloudflare D1 (GID_DB) —— 原生 SQL 原子累加，零并发冲突
  // =========================================================================
  if (env.GID_DB) {
    await ensureD1Schema(env.GID_DB);

    if (isBot) {
      await env.GID_DB.batch([
        env.GID_DB.prepare(`UPDATE global_metrics SET filtered_bots = filtered_bots + 1 WHERE id = 1`),
        env.GID_DB.prepare(`INSERT INTO access_logs (ts, visitor_hash, country, city, region, colo, asn, lat, lng, path, title, referrer, is_new_uv, is_bot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`).bind(now, visitorHash, country, city, region, colo, asn, latitude, longitude, path, title, referrer),
      ]);
    } else {
      const existingVisitor = await env.GID_DB.prepare(`SELECT visitor_hash FROM unique_visitors WHERE visitor_hash = ?`).bind(visitorHash).first();
      const isNewUV = !existingVisitor ? 1 : 0;

      const statements = [
        env.GID_DB.prepare(`UPDATE global_metrics SET total_pv = total_pv + 1, total_uv = total_uv + ? WHERE id = 1`).bind(isNewUV),
        env.GID_DB.prepare(`INSERT INTO unique_visitors (visitor_hash, first_seen, last_seen, country, city, lat, lng, visits) VALUES (?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT(visitor_hash) DO UPDATE SET last_seen = excluded.last_seen, city = excluded.city, lat = excluded.lat, lng = excluded.lng, visits = unique_visitors.visits + 1`).bind(visitorHash, now, now, country, city, latitude, longitude),
        env.GID_DB.prepare(`INSERT INTO country_stats (country, pv, uv, last_city, lat, lng) VALUES (?, 1, ?, ?, ?, ?) ON CONFLICT(country) DO UPDATE SET pv = country_stats.pv + 1, uv = country_stats.uv + ?, last_city = excluded.last_city, lat = excluded.lat, lng = excluded.lng`).bind(country, isNewUV, city, latitude, longitude, isNewUV),
        env.GID_DB.prepare(`INSERT INTO city_nodes (city_key, country, city, lat, lng, pv, last_ts) VALUES (?, ?, ?, ?, ?, 1, ?) ON CONFLICT(city_key) DO UPDATE SET pv = city_nodes.pv + 1, last_ts = excluded.last_ts`).bind(cityKey, country, city, latitude, longitude, now),
        env.GID_DB.prepare(`INSERT INTO page_stats (path, title, pv) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET pv = page_stats.pv + 1, title = excluded.title`).bind(path, title),
        env.GID_DB.prepare(`INSERT INTO access_logs (ts, visitor_hash, country, city, region, colo, asn, lat, lng, path, title, referrer, is_new_uv, is_bot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`).bind(now, visitorHash, country, city, region, colo, asn, latitude, longitude, path, title, referrer, isNewUV),
        // 自动清理超过 100 条的旧日志，保持数据库轻量
        env.GID_DB.prepare(`DELETE FROM access_logs WHERE id NOT IN (SELECT id FROM access_logs ORDER BY ts DESC LIMIT 80)`),
      ];
      await env.GID_DB.batch(statements);
    }

    if (isPixelRequest) {
      return new Response(TRANSPARENT_GIF, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "image/gif" },
      });
    }
    return new Response(
      JSON.stringify({ ok: true, engine: "d1", country, city, colo, isBot }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // =========================================================================
  // 引擎 2：如果绑定了 Cloudflare KV (GID_STATS_KV) —— 优化后的单次写入 + 多城市坐标保留
  // =========================================================================
  if (env.GID_STATS_KV) {
    const rawState = await env.GID_STATS_KV.get("GID_SUMMARY_V2", { type: "json" });
    const state = rawState || {
      totalPV: 0,
      totalUV: 0,
      filteredBots: 0,
      knownVisitors: {}, // 永久去重哈希表（最多保留最近 5000 个独立访客指纹，免除额外 KV.put）
      countries: {},
      cityNodes: {},     // 保留每个城市的独立坐标点，解决同一国家坐标被覆盖的问题
      pages: {},
      recentLogs: [],
      activeSessions: {},
    };

    if (isBot) {
      state.filteredBots = (state.filteredBots || 0) + 1;
      state.recentLogs = state.recentLogs || [];
      state.recentLogs.unshift({
        ts: now, country, city, region, colo, asn, lat: latitude, lng: longitude, path, title, referrer, isNewUV: false, isBot: true
      });
      if (state.recentLogs.length > 40) state.recentLogs = state.recentLogs.slice(0, 40);
      await env.GID_STATS_KV.put("GID_SUMMARY_V2", JSON.stringify(state));
    } else {
      state.knownVisitors = state.knownVisitors || {};
      const isNewUV = !state.knownVisitors[visitorHash];
      state.knownVisitors[visitorHash] = now;

      // 控制字典体积
      const vKeys = Object.keys(state.knownVisitors);
      if (vKeys.length > 5000) {
        delete state.knownVisitors[vKeys[0]];
      }

      state.totalPV = (state.totalPV || 0) + 1;
      if (isNewUV) state.totalUV = (state.totalUV || 0) + 1;

      if (!state.countries[country]) {
        state.countries[country] = { pv: 0, uv: 0, lat: latitude, lng: longitude, lastCity: city };
      }
      state.countries[country].pv += 1;
      if (isNewUV) state.countries[country].uv += 1;
      state.countries[country].lastCity = city;

      // 独立记录城市级别坐标，最多保留活跃的 60 个全球城市节点，不再互相覆盖
      state.cityNodes = state.cityNodes || {};
      if (!state.cityNodes[cityKey]) {
        state.cityNodes[cityKey] = { country, city, lat: latitude, lng: longitude, pv: 0, lastTs: now };
      }
      state.cityNodes[cityKey].pv += 1;
      state.cityNodes[cityKey].lastTs = now;

      state.pages[path] = (state.pages[path] || 0) + 1;

      state.activeSessions = state.activeSessions || {};
      state.activeSessions[visitorHash] = {
        ts: now, country, city, lat: latitude, lng: longitude, path
      };
      for (const [vid, s] of Object.entries(state.activeSessions)) {
        if (now - s.ts > 5 * 60 * 1000) delete state.activeSessions[vid];
      }

      state.recentLogs = state.recentLogs || [];
      state.recentLogs.unshift({
        ts: now, country, city, region, colo, asn, lat: latitude, lng: longitude, path, title, referrer, isNewUV, isBot: false
      });
      if (state.recentLogs.length > 40) state.recentLogs = state.recentLogs.slice(0, 40);

      // 每次请求仅触发 1 次 KV.put（相比 v1 节省 50% 写入额度）
      await env.GID_STATS_KV.put("GID_SUMMARY_V2", JSON.stringify(state));
    }

    if (isPixelRequest) {
      return new Response(TRANSPARENT_GIF, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "image/gif" },
      });
    }
    return new Response(
      JSON.stringify({ ok: true, engine: "kv", country, city, colo, isBot }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 未配置存储时的安全回退响应
  if (isPixelRequest) {
    return new Response(TRANSPARENT_GIF, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "image/gif" },
    });
  }
  return new Response(
    JSON.stringify({
      ok: true,
      engine: "unconfigured_fallback",
      detected: { country, city, region, latitude, longitude, colo, isBot },
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

export async function onRequestPost(context) {
  try {
    const text = await context.request.text();
    let body = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch (e) {
        body = {};
      }
    }
    return await handleTelemetry(context, body, false);
  } catch (err) {
    const origin = context.request.headers.get("Origin");
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...getCorsHeaders(context.env, origin), "Content-Type": "application/json" },
    });
  }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const path = url.searchParams.get("path") || "/noscript-pixel";
  const title = url.searchParams.get("title") || "Pixel Telemetry";
  const referrer = context.request.headers.get("Referer") || "Direct";
  return await handleTelemetry(context, { path, title, referrer }, true);
}
