const COPY = {
  zh: {
    live: "实时",
    users: "累计用户数",
    countries: "用户国家分布",
    visits: "累计访问数",
    parts: "累计访问部分",
    range: "时间",
    today: "今日",
    d7: "7 天",
    d30: "30 天",
    d90: "90 天",
    all: "全部",
    since: "含 Web Analytics 历史",
    window: "所选区间按日合计",
    scope: "全部记录",
    waiting: "新访问亮起，10 秒后熄灭",
    mapFail: "在线底图没有加载。",
    unbound: "D1 还没有绑到这个项目。",
    failed: "报告暂时读不出来。",
    updated: "更新于",
    empty: "还没有记录。",
    unknown: "未知",
  },
  en: {
    live: "Live",
    users: "Cumulative users",
    countries: "Countries",
    visits: "Cumulative visits",
    parts: "Visit breakdown",
    range: "Time",
    today: "Today",
    d7: "7 days",
    d30: "30 days",
    d90: "90 days",
    all: "All",
    since: "Includes Web Analytics history",
    window: "Daily total for this range",
    scope: "Full record",
    waiting: "A new visit lights up, then fades after 10s",
    mapFail: "The base map did not load.",
    unbound: "D1 is not bound to this project.",
    failed: "The report could not be loaded.",
    updated: "Updated",
    empty: "No records yet.",
    unknown: "Unknown",
  },
};

const RANGES = [["1", "today"], ["7", "d7"], ["30", "d30"], ["90", "d90"], ["all", "all"]];
let lang = (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
let names = regionNames();
let range = "all";
let latest = null;
let map;
let mapReady = false;
let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const seen = new Set();
const queue = [];
const sparks = { uv: [], pv: [] };
let travel = 0;
let waitTimer = 0;

function t(key) { return COPY[lang][key]; }
function regionNames() { return new Intl.DisplayNames([lang === "zh" ? "zh-CN" : "en"], { type: "region" }); }
function locale() { return lang === "zh" ? "zh-CN" : "en"; }
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function countryName(code) {
  if (!code || code === "XX" || code === "ZZ" || code === "T1") return t("unknown");
  try { return names.of(code) || code; } catch (e) { return code; }
}
function num(value) { return Number(value || 0).toLocaleString(locale()); }

function applyCopy() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  names = regionNames();
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.getElementById("lang").textContent = lang === "zh" ? "EN" : "中文";
  if (!document.querySelector(".hit")) document.getElementById("wait").textContent = t("waiting");
  renderRanges();
}

function renderRanges() {
  const nav = document.getElementById("ranges");
  nav.setAttribute("aria-label", t("range"));
  nav.innerHTML = `<p>${esc(t("range"))}</p>` + RANGES.map(([id, key]) => (
    `<button type="button" data-range="${id}" class="${id === range ? "on" : ""}" aria-pressed="${id === range}">${esc(t(key))}</button>`
  )).join("");
}

function sliceSeries(rows) {
  const all = rows || [];
  if (range === "all") return all;
  const days = Number(range);
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const cutoff = start.toISOString().slice(0, 10);
  return all.filter((row) => String(row.day) >= cutoff);
}

function tween(el, next) {
  const target = Number(next || 0);
  const from = el.dataset.value == null || el.dataset.value === "" ? target : Number(el.dataset.value);
  const token = Number(el.dataset.token || 0) + 1;
  el.dataset.token = String(token);
  el.dataset.value = String(target);
  if (reduced || from === target) {
    el.textContent = num(target);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    if (Number(el.dataset.token) !== token) return;
    const p = Math.min(1, (now - start) / 700);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = num(Math.round(from + (target - from) * eased));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function setMetric(id, value, ready, fromPoll) {
  const el = document.getElementById(id);
  const delta = document.getElementById(id.replace("metric", "delta"));
  if (!ready) {
    el.textContent = "—";
    el.dataset.value = "";
    delta.hidden = true;
    return;
  }
  const prev = el.dataset.value === "" || el.dataset.value == null ? null : Number(el.dataset.value);
  const target = Number(value || 0);
  if (fromPoll && prev != null && target > prev) {
    delta.hidden = false;
    delta.textContent = `+${num(target - prev)}`;
    delta.style.animation = "none";
    void delta.offsetWidth;
    delta.style.animation = "";
  }
  tween(el, target);
}

function drawSpark(canvas, values) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 2 || h < 2) return;
  const pw = Math.floor(w * ratio);
  const ph = Math.floor(h * ratio);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const series = values.length ? values : [0, 0];
  const max = Math.max(...series, 1);
  const top = h * 0.5;
  const bottom = h - 8;
  const pts = series.map((value, index) => {
    const x = series.length === 1 ? w / 2 : (index / (series.length - 1)) * w;
    const y = bottom - (value / max) * (bottom - top);
    return [x, y];
  });
  const gradient = ctx.createLinearGradient(0, top, 0, h);
  gradient.addColorStop(0, "rgba(15, 118, 110, 0.34)");
  gradient.addColorStop(1, "rgba(15, 118, 110, 0)");
  ctx.beginPath();
  pts.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.beginPath();
  pts.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = "rgba(15, 118, 110, 0.95)";
  ctx.lineWidth = 2.4;
  ctx.lineJoin = "round";
  ctx.stroke();
  const cursor = (reduced ? 1 : travel) * (pts.length - 1);
  const index = Math.floor(cursor);
  const rest = cursor - index;
  const a = pts[Math.min(index, pts.length - 1)];
  const b = pts[Math.min(index + 1, pts.length - 1)];
  ctx.beginPath();
  ctx.arc(a[0] + (b[0] - a[0]) * rest, a[1] + (b[1] - a[1]) * rest, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = "#0f766e";
  ctx.fill();
}

function paintCharts() {
  drawSpark(document.getElementById("spark-uv"), sparks.uv);
  drawSpark(document.getElementById("spark-pv"), sparks.pv);
  if (reduced) return;
  travel = (travel + 0.0018) % 1;
  requestAnimationFrame(paintCharts);
}

function bars(rows, labelOf, valueOf) {
  if (!rows.length) return `<p class="empty">${esc(t("empty"))}</p>`;
  const max = Math.max(...rows.map(valueOf), 1);
  return rows.map((row) => {
    const value = valueOf(row);
    const width = Math.max(4, Math.round((value / max) * 100));
    const label = labelOf(row);
    return `<div class="row"><div class="name" title="${esc(label)}">${esc(label)}</div><b class="live-num">${num(value)}</b><div class="bar"><i style="width:${width}%"></i></div></div>`;
  }).join("");
}

function renderLists(data) {
  const countries = Object.entries(data.countries || {})
    .map(([code, info]) => ({ code, uv: info.uv || 0, pv: info.pv || 0 }))
    .sort((a, b) => b.uv - a.uv || b.pv - a.pv)
    .slice(0, 5);
  document.getElementById("countries").innerHTML = bars(countries, (row) => countryName(row.code), (row) => row.uv || row.pv);
  const pages = (data.pages || []).slice(0, 5);
  document.getElementById("parts").innerHTML = bars(pages, (row) => row.path || "/", (row) => row.pv || 0);
  const scoped = range !== "all";
  document.getElementById("countries-note").hidden = !scoped;
  document.getElementById("parts-note").hidden = !scoped;
  document.getElementById("countries-note").textContent = t("scope");
  document.getElementById("parts-note").textContent = t("scope");
}

function placeLabel(row) {
  const where = [countryName(row.country), row.city].filter(Boolean).join(" · ");
  return [where || t("unknown"), row.path || ""].filter(Boolean).join(" · ");
}

function paintHit(lng, lat, remain, row) {
  const el = document.createElement("div");
  el.className = "hit";
  el.innerHTML = "<i></i>";
  el.querySelector("i").style.animationDuration = `${remain}ms`;
  const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([lng, lat]).addTo(map);
  document.getElementById("wait").textContent = placeLabel(row);
  window.clearTimeout(waitTimer);
  window.setTimeout(() => marker.remove(), remain);
  waitTimer = window.setTimeout(() => {
    if (!document.querySelector(".hit")) document.getElementById("wait").textContent = t("waiting");
  }, remain + 40);
}

function spawn(lng, lat, row) {
  if (!mapReady) {
    queue.push({ lng, lat, row });
    return;
  }
  paintHit(lng, lat, 10000, row);
}

function flushQueue() {
  const now = Date.now();
  queue.splice(0).forEach((item) => {
    const age = now - Number(item.row.ts || 0);
    if (Number.isFinite(age) && age > 12000) return;
    paintHit(item.lng, item.lat, 10000, item.row);
  });
}

function ingest(logs) {
  const now = Date.now();
  (logs || []).forEach((row) => {
    const key = [row.ts, row.path, row.country, row.lat, row.lng].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    if (row.isBot) return;
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const age = now - Number(row.ts || 0);
    if (!Number.isFinite(age) || age > 12000) return;
    spawn(lng, lat, row);
  });
  if (seen.size > 800) {
    [...seen].slice(0, seen.size - 500).forEach((key) => seen.delete(key));
  }
}

let framing = false;

function frameWorld() {
  if (!mapReady || framing) return;
  const canvas = map.getCanvas();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width < 240 || height < 240) return;
  const narrow = width < 980;
  const pad = narrow
    ? { top: 156, bottom: Math.min(Math.round(height * 0.52), height - 230), left: 8, right: 8 }
    : { top: 76, bottom: 22, left: 154, right: 348 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  if (innerW < 160 || innerH < 120) return;
  const zoom = Math.max(0, Math.log2((innerW + 80) / 512));
  framing = true;
  map.setMinZoom(0);
  map.jumpTo({ center: [12, 8], zoom, padding: pad });
  map.setMinZoom(zoom);
  framing = false;
}

function initMap() {
  if (!window.maplibregl) {
    document.getElementById("map-fallback").hidden = false;
    return;
  }
  map = new maplibregl.Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/positron",
    center: [12, 18],
    zoom: 1.25,
    renderWorldCopies: true,
    attributionControl: true,
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-left");
  map.touchZoomRotate.disableRotation();
  map.on("error", () => { document.getElementById("map-fallback").hidden = false; });
  map.on("load", () => {
    mapReady = true;
    frameWorld();
    flushQueue();
  });
}

function render(data, fromPoll) {
  latest = data;
  const banner = document.getElementById("banner");
  if (!data.configured) {
    banner.hidden = false;
    banner.textContent = t("unbound");
  } else if (data.ok === false) {
    banner.hidden = false;
    banner.textContent = data.error || t("failed");
  } else {
    banner.hidden = true;
  }
  const ready = data.configured && data.ok !== false;
  const rows = sliceSeries(data.series || []);
  const sumUV = rows.reduce((sum, row) => sum + (Number(row.uv) || 0), 0);
  const sumPV = rows.reduce((sum, row) => sum + (Number(row.pv) || 0), 0);
  const users = range === "all" ? Number(data.totalUV || sumUV) : sumUV;
  const visits = range === "all" ? Number(data.totalPV || sumPV) : sumPV;
  setMetric("metric-uv", users, ready, fromPoll);
  setMetric("metric-pv", visits, ready, fromPoll);
  const note = range === "all" ? t("since") : t("window");
  document.getElementById("users-note").textContent = note;
  document.getElementById("visits-note").textContent = note;
  sparks.uv = rows.map((row) => Number(row.uv) || 0);
  sparks.pv = rows.map((row) => Number(row.pv) || 0);
  renderLists(data);
  ingest(data.recentLogs || []);
  if (reduced) paintCharts();
}

function stamp() {
  document.getElementById("updated").textContent = `${t("updated")} ${new Date().toLocaleTimeString(locale(), { hour12: false })}`;
}

async function refresh() {
  try {
    const response = await fetch("/api/stats", { cache: "no-store" });
    render(await response.json(), true);
  } catch (e) {
    render({ configured: true, ok: false, error: t("failed"), countries: {}, pages: [], recentLogs: [], series: [] });
  }
}

document.getElementById("ranges").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  range = button.dataset.range;
  renderRanges();
  if (latest) render(latest);
});
document.getElementById("lang").addEventListener("click", () => {
  lang = lang === "zh" ? "en" : "zh";
  applyCopy();
  if (latest) render(latest);
});
window.addEventListener("resize", () => {
  if (map) {
    map.resize();
    frameWorld();
  }
});
applyCopy();
stamp();
setInterval(stamp, 1000);
initMap();
paintCharts();
refresh();
setInterval(refresh, 3000);
