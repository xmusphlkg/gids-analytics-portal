const VIEWS = ["overview", "realtime", "pages", "locations"];
const COPY = {
  zh: {
    overview: "概览", realtime: "实时", pages: "网页", locations: "地理位置", site: "返回主站",
    overviewTitle: "概览", realtimeTitle: "实时", pagesTitle: "网页和屏幕", locationsTitle: "地理位置",
    active: "活跃用户", activeHint: "过去 5 分钟", users: "用户", usersHint: "累计独立读者",
    views: "浏览量", viewsHint: "累计页面浏览", bots: "自动访问", botsHint: "已识别的脚本与爬虫",
    map: "用户所在位置", mapHint: "在线地图", mapFail: "在线底图没有加载。地区列表仍然可用。",
    countries: "国家/地区", pages: "网页", stream: "最近事件", streamHint: "最近保存的访问",
    empty: "还没有主站访问。把 tracker.js 加到 globalinfectiousdisease.com 后，这里会显示真实读者。",
    unbound: "D1 数据库还没有绑到这个 Pages 项目，报告无法写入。",
    failed: "报告暂时读不出来。", updated: "更新于", you: "当前网络出口",
    time: "时间", place: "地区", page: "网页", source: "来源", kind: "类型",
    user: "用户", view: "浏览量", newUser: "新用户", returning: "回访", bot: "自动访问", unknown: "未知", direct: "直接访问",
  },
  en: {
    overview: "Overview", realtime: "Realtime", pages: "Pages", locations: "Locations", site: "Back to GIDS",
    overviewTitle: "Overview", realtimeTitle: "Realtime", pagesTitle: "Pages and screens", locationsTitle: "Locations",
    active: "Active users", activeHint: "Last 5 minutes", users: "Users", usersHint: "All-time readers",
    views: "Views", viewsHint: "All-time page views", bots: "Automated", botsHint: "Scripts and crawlers",
    map: "Users by location", mapHint: "Live map", mapFail: "The base map did not load. The location list is still available.",
    countries: "Countries", pages: "Pages", stream: "Recent events", streamHint: "Latest stored hits",
    empty: "No public-site traffic yet. Add tracker.js to globalinfectiousdisease.com to record readers.",
    unbound: "D1 is not bound to this Pages project, so the report cannot store hits.",
    failed: "The report could not be loaded.", updated: "Updated", you: "This network exit",
    time: "Time", place: "Location", page: "Page", source: "Source", kind: "Type",
    user: "Users", view: "Views", newUser: "New", returning: "Returning", bot: "Automated", unknown: "Unknown", direct: "Direct",
  },
};

const ICONS = {
  overview: '<svg viewBox="0 0 24 24"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/></svg>',
  realtime: '<svg viewBox="0 0 24 24"><path d="M4 12h4l2-5 4 10 2-5h4"/></svg>',
  pages: '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v6h6"/></svg>',
  locations: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M2 12h20M12 4a12 12 0 0 1 0 16M12 4a12 12 0 0 0 0 16"/></svg>',
};

let lang = (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
let view = (location.hash || "#overview").slice(1);
if (!VIEWS.includes(view)) view = "overview";
let names = regionNames();
let map;
let markers;
let fitted = false;
let latest = null;

function t(key) { return COPY[lang][key]; }
function regionNames() { return new Intl.DisplayNames([lang === "zh" ? "zh-CN" : "en"], { type: "region" }); }
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function num(value) { return Number(value || 0).toLocaleString(lang === "zh" ? "zh-CN" : "en"); }
function countryName(code) {
  if (!code || code === "XX" || code === "ZZ" || code === "T1") return t("unknown");
  try { return names.of(code) || code; } catch (e) { return code; }
}
function place(row) {
  const where = [countryName(row.country), row.city].filter(Boolean).join(" · ");
  return where || t("unknown");
}
function hostOf(referrer) {
  if (!referrer || referrer === "Direct") return t("direct");
  try { return new URL(referrer).host || referrer; } catch (e) { return referrer; }
}

function applyCopy() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.title = "GIDS Analytics";
  names = regionNames();
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.getElementById("title").textContent = t(view + "Title");
  document.getElementById("lang").textContent = lang === "zh" ? "EN" : "中文";
  document.getElementById("nav").innerHTML = VIEWS.map((id) => (
    `<button type="button" data-view="${id}" ${id === view ? 'aria-current="page"' : ""}>${ICONS[id]}<span>${esc(t(id))}</span></button>`
  )).join("");
  document.body.dataset.view = view;
}

function setView(next) {
  view = next;
  history.replaceState(null, "", "#" + next);
  applyCopy();
  if (latest) render(latest);
  if (map && (view === "overview" || view === "realtime" || view === "locations")) {
    setTimeout(() => map.invalidateSize(), 40);
  }
}

function initMap() {
  if (!window.L) {
    document.getElementById("map-fallback").hidden = false;
    return;
  }
  map = L.map("map", { worldCopyJump: true, minZoom: 2, zoomControl: true }).setView([20, 0], 2);
  const tiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap &copy; CARTO",
  }).addTo(map);
  markers = L.layerGroup().addTo(map);
  let errors = 0;
  tiles.on("tileerror", () => {
    errors += 1;
    if (errors > 4) document.getElementById("map-fallback").hidden = false;
  });
}

function renderMap(data) {
  if (!map || !markers) return;
  markers.clearLayers();
  const points = [];
  for (const node of data.cityNodes || []) {
    if (!Number.isFinite(node.lat) || !Number.isFinite(node.lng)) continue;
    points.push([node.lat, node.lng]);
    const radius = Math.max(6, Math.min(18, 4 + Math.sqrt(node.pv || 1) * 2));
    L.circleMarker([node.lat, node.lng], {
      radius, color: "#0f766e", weight: 1, fillColor: "#0f766e", fillOpacity: 0.78,
    }).bindPopup(`<strong>${esc(countryName(node.country))}</strong><br>${esc(node.city || "")}<br>${num(node.pv)} ${esc(t("views"))}`).addTo(markers);
  }
  const viewer = data.viewer || {};
  if (Number.isFinite(viewer.latitude) && Number.isFinite(viewer.longitude)) {
    L.circleMarker([viewer.latitude, viewer.longitude], {
      radius: 7, color: "#9a3412", weight: 2, fillColor: "#fdba74", fillOpacity: 0.9,
    }).bindPopup(esc(t("you"))).addTo(markers);
  }
  if (!fitted && points.length) {
    map.fitBounds(points.length === 1 ? L.latLngBounds(points[0], points[0]).pad(0.8) : points, { padding: [36, 36], maxZoom: 4 });
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
    const pct = Math.max(2, Math.round(((info.uv || 0) / max) * 100));
    return `<div class="row"><div><b>${esc(countryName(code))}</b><div class="bar"><i style="width:${pct}%"></i></div></div><span>${num(info.uv)} ${esc(t("user"))}</span></div>`;
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
    rows.map((row) => `<tr><td><div>${esc(row.title || row.path)}</div><div class="path">${esc(row.path)}</div><div class="bar"><i style="width:${Math.max(2, Math.round((row.pv / max) * 100))}%"></i></div></td><td class="num">${num(row.pv)}</td></tr>`).join("")
  }</tbody></table>`;
}

function renderStream(data) {
  const logs = data.recentLogs || [];
  const humans = logs.filter((row) => !row.isBot);
  const bins = Array(18).fill(0);
  const now = Date.now();
  for (const row of humans) {
    const age = Math.floor((now - row.ts) / 60000);
    if (age >= 0 && age < bins.length) bins[bins.length - 1 - age] += 1;
  }
  const peak = Math.max(1, ...bins);
  document.getElementById("bars").innerHTML = bins.map((count) => `<span style="height:${Math.max(4, Math.round((count / peak) * 56))}px"></span>`).join("");
  const root = document.getElementById("stream");
  if (!logs.length) {
    root.innerHTML = `<p class="empty">${esc(t("empty"))}</p>`;
    return;
  }
  root.innerHTML = `<table><thead><tr><th>${esc(t("time"))}</th><th>${esc(t("place"))}</th><th>${esc(t("page"))}</th><th>${esc(t("source"))}</th><th>${esc(t("kind"))}</th></tr></thead><tbody>${
    logs.slice(0, 12).map((row) => {
      const when = new Date(row.ts).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en", { hour12: false });
      const kind = row.isBot ? "bot" : row.isNewUV ? "newUser" : "returning";
      return `<tr><td>${esc(when)}</td><td>${esc(place(row))}${row.colo ? `<div class="path">${esc(row.colo)}</div>` : ""}</td><td class="path">${esc(row.path)}</td><td>${esc(hostOf(row.referrer))}</td><td><span class="tag ${row.isBot ? "bot" : ""}">${esc(t(kind))}</span></td></tr>`;
    }).join("")
  }</tbody></table>`;
}

function render(data) {
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
  const cards = [
    ["active", data.onlineCount, "activeHint"],
    ["users", data.totalUV, "usersHint"],
    ["views", data.totalPV, "viewsHint"],
    ["bots", data.filteredBots, "botsHint"],
  ];
  document.getElementById("metrics").innerHTML = cards.map(([key, value, hint], index) => (
    `<article class="metric ${index === 0 ? "active" : ""}"><span>${esc(t(key))}</span><strong>${data.configured && data.ok !== false ? num(value) : "—"}</strong><em>${esc(t(hint))}</em></article>`
  )).join("");
  renderCountries(data);
  renderPages(data);
  renderStream(data);
  renderMap(data);
  const stamp = new Date().toLocaleTimeString(lang === "zh" ? "zh-CN" : "en", { hour12: false });
  document.getElementById("updated").textContent = `${t("updated")} ${stamp}`;
}

async function refresh() {
  try {
    const response = await fetch("/api/stats", { cache: "no-store" });
    const data = await response.json();
    render(data);
  } catch (e) {
    render({ configured: true, ok: false, error: t("failed"), countries: {}, pages: [], recentLogs: [], cityNodes: [] });
  }
}

document.getElementById("nav").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button) setView(button.dataset.view);
});
document.getElementById("lang").addEventListener("click", () => {
  lang = lang === "zh" ? "en" : "zh";
  applyCopy();
  if (latest) render(latest);
});

applyCopy();
initMap();
refresh();
setInterval(refresh, 10000);
