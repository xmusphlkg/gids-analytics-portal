const COPY = {
  zh: {
    live: "实时", active: "活跃读者", activeHint: "过去 5 分钟",
    users: "访问", usersHint: "含 Web Analytics 历史", views: "浏览量", viewsHint: "页面打开次数",
    bots: "自动访问", botsHint: "已识别的脚本与爬虫",
    map: "读者位置", mapHint: "在线地图", mapFail: "在线底图没有加载。地区列表仍然可用。",
    countries: "国家/地区", pages: "网页", stream: "实时事件", streamHint: "信标写入后出现",
    empty: "主站信标生效后，新的访问会显示在这里。",
    unbound: "D1 还没有绑到这个项目。", failed: "报告暂时读不出来。",
    note: "折线是 Cloudflare Web Analytics 的每日浏览量。数字会在新访问到达时跳动。",
    updated: "更新于", time: "时间", place: "地区", page: "网页", source: "来源", kind: "类型",
    user: "访问", view: "浏览量", newUser: "新访问", returning: "再次访问", bot: "自动访问",
    unknown: "未知", direct: "直接访问",
  },
  en: {
    live: "Live", active: "Active readers", activeHint: "Last 5 minutes",
    users: "Visits", usersHint: "Includes Web Analytics history", views: "Views", viewsHint: "Page opens",
    bots: "Automated", botsHint: "Scripts and crawlers",
    map: "Reader locations", mapHint: "Live map", mapFail: "The base map did not load. The location list is still available.",
    countries: "Countries", pages: "Pages", stream: "Live events", streamHint: "Appears as beacons arrive",
    empty: "New visits show up here after the public site beacon is active.",
    unbound: "D1 is not bound to this project.", failed: "The report could not be loaded.",
    note: "The line is daily page views from Cloudflare Web Analytics. Figures tick as new visits arrive.",
    updated: "Updated", time: "Time", place: "Location", page: "Page", source: "Source", kind: "Type",
    user: "Visits", view: "Views", newUser: "New", returning: "Returning", bot: "Automated",
    unknown: "Unknown", direct: "Direct",
  },
};

let lang = (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
let names = regionNames();
let map;
let mapReady = false;
let fitted = false;
let latest = null;
let popup;
let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const shown = {};

function t(key) { return COPY[lang][key]; }
function regionNames() { return new Intl.DisplayNames([lang === "zh" ? "zh-CN" : "en"], { type: "region" }); }
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function countryName(code) {
  if (!code || code === "XX" || code === "ZZ" || code === "T1") return t("unknown");
  try { return names.of(code) || code; } catch (e) { return code; }
}
function hostOf(referrer) {
  if (!referrer || referrer === "Direct") return t("direct");
  try { return new URL(referrer).host || referrer; } catch (e) { return referrer; }
}

function applyCopy() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  names = regionNames();
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.getElementById("lang").textContent = lang === "zh" ? "EN" : "中文";
  document.getElementById("note").textContent = t("note");
}

function tween(el, next) {
  const target = Number(next || 0);
  const from = Number(el.dataset.value || 0);
  el.dataset.value = String(target);
  if (reduced || from === target) {
    el.textContent = target.toLocaleString(lang === "zh" ? "zh-CN" : "en");
    return;
  }
  el.parentElement.classList.add("tick");
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / 650);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (target - from) * eased).toLocaleString(lang === "zh" ? "zh-CN" : "en");
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const canvas = document.getElementById("bg");
const ctx = canvas.getContext("2d");
let series = [];
let travel = 0;

function resizeCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * ratio);
  canvas.height = Math.floor(window.innerHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function linePoints() {
  const values = series.length ? series.map((row) => row.pv || 0) : [0, 0];
  const w = window.innerWidth;
  const h = window.innerHeight;
  const max = Math.max(...values, 1);
  const left = 8;
  const right = w - 8;
  const top = 96;
  const bottom = Math.min(360, h * 0.48);
  return values.map((value, index) => {
    const x = left + (values.length === 1 ? 0.5 : index / (values.length - 1)) * (right - left);
    const y = bottom - (value / max) * (bottom - top);
    return [x, y];
  });
}

function drawBackground() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);
  const points = linePoints();
  if (points.length < 2) return;
  const gradient = ctx.createLinearGradient(0, points[0][1], 0, h * 0.78);
  gradient.addColorStop(0, "rgba(15, 118, 110, 0.28)");
  gradient.addColorStop(1, "rgba(15, 118, 110, 0)");
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.lineTo(points[points.length - 1][0], h * 0.78);
  ctx.lineTo(points[0][0], h * 0.78);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.strokeStyle = "rgba(15, 118, 110, 0.9)";
  ctx.lineWidth = 3;
  ctx.stroke();
  if (reduced) return;
  travel = (travel + 0.0016) % 1;
  const cursor = travel * (points.length - 1);
  const i = Math.floor(cursor);
  const f = cursor - i;
  const a = points[i];
  const b = points[Math.min(points.length - 1, i + 1)];
  const x = a[0] + (b[0] - a[0]) * f;
  const y = a[1] + (b[1] - a[1]) * f;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fillStyle = "#0f766e";
  ctx.fill();
  requestAnimationFrame(drawBackground);
}

function readerFeatures(rows) {
  return {
    type: "FeatureCollection",
    features: (rows || []).filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng)).map((row) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [row.lng, row.lat] },
      properties: { country: row.country || row.code, pv: row.pv || row.uv || 0, city: row.city || row.lastCity || "" },
    })),
  };
}

function initMap() {
  if (!window.maplibregl) {
    document.getElementById("map-fallback").hidden = false;
    return;
  }
  map = new maplibregl.Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/positron",
    center: [10, 20],
    zoom: 1.3,
    renderWorldCopies: false,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
  map.on("error", () => { document.getElementById("map-fallback").hidden = false; });
  map.on("load", () => {
    map.addSource("readers", { type: "geojson", data: readerFeatures([]) });
    map.addLayer({
      id: "readers",
      type: "circle",
      source: "readers",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "pv"], 1, 5, 20000, 22],
        "circle-color": "#0f766e",
        "circle-opacity": 0.86,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });
    map.on("click", "readers", (event) => {
      const feature = event.features && event.features[0];
      if (!feature) return;
      const props = feature.properties || {};
      if (popup) popup.remove();
      popup = new maplibregl.Popup({ closeButton: false, offset: 12 })
        .setLngLat(feature.geometry.coordinates)
        .setHTML(`<strong>${esc(countryName(props.country))}</strong><br>${esc(props.city)}<br>${Number(props.pv || 0).toLocaleString()} ${esc(t("views"))}`)
        .addTo(map);
    });
    mapReady = true;
    if (latest) renderMap(latest);
  });
}

function renderMap(data) {
  if (!mapReady) return;
  const countries = Object.entries(data.countries || {}).map(([code, info]) => ({
    code, country: code, lat: info.lat, lng: info.lng, pv: info.pv, uv: info.uv, city: info.lastCity,
  }));
  const collection = readerFeatures(countries);
  map.getSource("readers").setData(collection);
  if (!fitted && collection.features.length) {
    const bounds = new maplibregl.LngLatBounds();
    collection.features.forEach((feature) => bounds.extend(feature.geometry.coordinates));
    map.fitBounds(bounds, { padding: 64, maxZoom: 3.2, duration: 0 });
    fitted = true;
  }
}

function renderCountries(data) {
  const entries = Object.entries(data.countries || {}).sort((a, b) => (b[1].uv || 0) - (a[1].uv || 0)).slice(0, 8);
  const max = entries.reduce((sum, item) => sum + (item[1].uv || 0), 0) || 1;
  const root = document.getElementById("countries");
  if (!entries.length) {
    root.innerHTML = `<p class="empty">${esc(t("empty"))}</p>`;
    return;
  }
  root.innerHTML = entries.map(([code, info]) => {
    const pct = Math.max(4, Math.round(((info.uv || 0) / max) * 100));
    return `<div class="row"><div><b>${esc(countryName(code))}</b><div class="bar"><i style="width:${pct}%"></i></div></div><span>${Number(info.uv || 0).toLocaleString(lang === "zh" ? "zh-CN" : "en")} ${esc(t("user"))}</span></div>`;
  }).join("");
}

function renderPages(data) {
  const rows = data.pages || [];
  const root = document.getElementById("pages");
  if (!rows.length) {
    root.innerHTML = `<p class="empty">${esc(t("empty"))}</p>`;
    return;
  }
  const max = rows[0].pv || 1;
  root.innerHTML = `<table><thead><tr><th>${esc(t("page"))}</th><th class="num">${esc(t("view"))}</th></tr></thead><tbody>${
    rows.slice(0, 8).map((row) => `<tr><td><div class="path">${esc(row.path)}</div><div class="bar"><i style="width:${Math.max(4, Math.round((row.pv / max) * 100))}%"></i></div></td><td class="num">${Number(row.pv || 0).toLocaleString(lang === "zh" ? "zh-CN" : "en")}</td></tr>`).join("")
  }</tbody></table>`;
}

function renderStream(data) {
  const logs = data.recentLogs || [];
  const root = document.getElementById("stream");
  if (!logs.length) {
    root.innerHTML = `<p class="empty">${esc(t("empty"))}</p>`;
    return;
  }
  root.innerHTML = `<table><thead><tr><th>${esc(t("time"))}</th><th>${esc(t("place"))}</th><th>${esc(t("page"))}</th><th>${esc(t("source"))}</th><th>${esc(t("kind"))}</th></tr></thead><tbody>${
    logs.slice(0, 10).map((row) => {
      const when = new Date(row.ts).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en", { hour12: false });
      const kind = row.isBot ? "bot" : row.isNewUV ? "newUser" : "returning";
      const fresh = !shown[row.ts] ? "fresh" : "";
      return `<tr class="${fresh}"><td>${esc(when)}</td><td>${esc([countryName(row.country), row.city].filter(Boolean).join(" · ") || t("unknown"))}</td><td class="path">${esc(row.path)}</td><td>${esc(hostOf(row.referrer))}</td><td><span class="tag ${row.isBot ? "bot" : ""}">${esc(t(kind))}</span></td></tr>`;
    }).join("")
  }</tbody></table>`;
  logs.slice(0, 10).forEach((row) => { shown[row.ts] = true; });
}

function render(data) {
  latest = data;
  series = data.series || [];
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
  const cards = [
    ["active", data.onlineCount, "activeHint"],
    ["users", data.totalUV, "usersHint"],
    ["views", data.totalPV, "viewsHint"],
    ["bots", data.filteredBots, "botsHint"],
  ];
  const root = document.getElementById("metrics");
  if (!root.children.length) {
    root.innerHTML = cards.map(([key, , hint]) => `<article class="metric"><span>${esc(t(key))}</span><strong data-metric="${key}">—</strong><em>${esc(t(hint))}</em></article>`).join("");
  }
  cards.forEach(([key, value, hint]) => {
    const card = root.querySelector(`[data-metric="${key}"]`);
    card.previousElementSibling.textContent = t(key);
    card.nextElementSibling.textContent = t(hint);
    if (ready) tween(card, value || 0);
    else card.textContent = "—";
  });
  renderCountries(data);
  renderPages(data);
  renderStream(data);
  renderMap(data);
  const stamp = new Date().toLocaleTimeString(lang === "zh" ? "zh-CN" : "en", { hour12: false });
  document.getElementById("updated").textContent = `${t("updated")} ${stamp}`;
  if (reduced) drawBackground();
}

async function refresh() {
  try {
    const response = await fetch("/api/stats", { cache: "no-store" });
    render(await response.json());
  } catch (e) {
    render({ configured: true, ok: false, error: t("failed"), countries: {}, pages: [], recentLogs: [], series: [] });
  }
}

document.getElementById("lang").addEventListener("click", () => {
  lang = lang === "zh" ? "en" : "zh";
  applyCopy();
  if (latest) render(latest);
});
window.addEventListener("resize", () => { resizeCanvas(); if (map) map.resize(); });

applyCopy();
resizeCanvas();
drawBackground();
if (reduced) drawBackground();
initMap();
refresh();
setInterval(refresh, 5000);
