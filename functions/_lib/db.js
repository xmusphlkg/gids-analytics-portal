const BOT_UA = /bot|crawler|spider|crawling|headless|lighthouse|pingdom|gtmetrix|uptime|python|curl|wget|scrapy|axios|go-http-client|java\/|okhttp|ahrefs|semrush|mj12bot|dotbot|bytespider|gptbot|claudebot|ccbot|perplexity|anthropic|facebookexternalhit|bingpreview/i;
const CLOUD_ASN = /amazon|aws|google cloud|microsoft|digitalocean|linode|vultr|hetzner|ovh|choopa|contabo|alibaba|tencent|huawei|oracle|m247|datacamp|fly\.io|render/i;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS global_metrics (id INTEGER PRIMARY KEY CHECK (id = 1), total_pv INTEGER NOT NULL DEFAULT 0, total_uv INTEGER NOT NULL DEFAULT 0, filtered_bots INTEGER NOT NULL DEFAULT 0)`,
  `INSERT OR IGNORE INTO global_metrics (id, total_pv, total_uv, filtered_bots) VALUES (1, 0, 0, 0)`,
  `CREATE TABLE IF NOT EXISTS unique_visitors (visitor_hash TEXT PRIMARY KEY, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, country TEXT NOT NULL, city TEXT NOT NULL, lat REAL, lng REAL, visits INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS country_stats (country TEXT PRIMARY KEY, pv INTEGER NOT NULL DEFAULT 0, uv INTEGER NOT NULL DEFAULT 0, last_city TEXT NOT NULL, lat REAL, lng REAL)`,
  `CREATE TABLE IF NOT EXISTS city_nodes (city_key TEXT PRIMARY KEY, country TEXT NOT NULL, city TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, pv INTEGER NOT NULL DEFAULT 0, last_ts INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS page_stats (path TEXT PRIMARY KEY, title TEXT NOT NULL, pv INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS access_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, visitor_hash TEXT NOT NULL, country TEXT NOT NULL, city TEXT NOT NULL, region TEXT, colo TEXT NOT NULL, asn TEXT, lat REAL, lng REAL, path TEXT NOT NULL, title TEXT NOT NULL, referrer TEXT NOT NULL, is_new_uv INTEGER NOT NULL DEFAULT 0, is_bot INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_ts ON access_logs(ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON unique_visitors(last_seen DESC)`,
];

let schemaReady = false;

export function isAllowedOrigin(requestOrigin, allowedOriginEnv) {
  if (!requestOrigin) return true;
  if (allowedOriginEnv === "*") return true;
  try {
    const host = new URL(requestOrigin).hostname.toLowerCase();
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

export function corsHeaders(env, requestOrigin, methods) {
  const allowed = env.ALLOWED_ORIGIN || "https://globalinfectiousdisease.com";
  const allow = isAllowedOrigin(requestOrigin, allowed) ? (requestOrigin || "*") : allowed;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
  };
}

export async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  schemaReady = true;
}

export async function hashVisitor(ip, ua, country) {
  const raw = `${ip}::${String(ua).slice(0, 100)}::${country}::gid-v3`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 20);
}

export function readGeo(request) {
  const cf = request.cf || {};
  const lat = cf.latitude === undefined || cf.latitude === "" ? null : Number(cf.latitude);
  const lng = cf.longitude === undefined || cf.longitude === "" ? null : Number(cf.longitude);
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);
  return {
    country: cf.country || "XX",
    city: cf.city || cf.region || "",
    region: cf.region || "",
    colo: cf.colo || "",
    asn: cf.asn ? `AS${cf.asn}` : "",
    asOrg: String(cf.asOrganization || "").toLowerCase(),
    lat: hasPoint ? lat : null,
    lng: hasPoint ? lng : null,
    botScore: cf.botManagement && typeof cf.botManagement.score === "number" ? cf.botManagement.score : 99,
    verifiedBot: Boolean(cf.botManagement && cf.botManagement.verifiedBot),
  };
}

export function classifyBot(request, payload, geo, isPixel) {
  const ua = request.headers.get("User-Agent") || "";
  return geo.verifiedBot || geo.botScore < 30 || BOT_UA.test(ua) || Boolean(payload.webdriver) || (isPixel && CLOUD_ASN.test(geo.asOrg));
}
