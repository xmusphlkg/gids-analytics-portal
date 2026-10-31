const COPY = {
  zh: {
    live: "实时",
    users: "累计用户数",
    countries: "用户国家分布",
    visits: "累计访问数",
    parts: "累计访问部分",
    range: "时间",
    today: "今日",
    yesterday: "昨天",
    d7: "过去 7 天",
    d30: "过去 30 天",
    d90: "过去 90 天",
    month: "本月",
    lastMonth: "上月",
    all: "全部",
    cancel: "取消",
    apply: "应用",
    close: "关闭",
    other: "其他",
    since: "含 Web Analytics 历史",
    window: "所选区间按日合计",
    scope: "全部记录",
    stackHint: "按国家堆积。区间较长时按周合并。",
    weekdays: "一二三四五六日",
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
    yesterday: "Yesterday",
    d7: "Last 7 days",
    d30: "Last 30 days",
    d90: "Last 90 days",
    month: "This month",
    lastMonth: "Last month",
    all: "All",
    cancel: "Cancel",
    apply: "Apply",
    close: "Close",
    other: "Other",
    since: "Includes Web Analytics history",
    window: "Daily total for this range",
    scope: "Full record",
    stackHint: "Stacked by country. Longer ranges are grouped by week.",
    weekdays: "MoTuWeThFrSaSu",
    waiting: "A new visit lights up, then fades after 10s",
    mapFail: "The base map did not load.",
    unbound: "D1 is not bound to this project.",
    failed: "The report could not be loaded.",
    updated: "Updated",
    empty: "No records yet.",
    unknown: "Unknown",
  },
};

const PRESETS = [["today", "today"], ["yesterday", "yesterday"], ["7", "d7"], ["30", "d30"], ["90", "d90"], ["month", "month"], ["lastMonth", "lastMonth"], ["all", "all"]];
const COLORS = ["#0f766e", "#102a43", "#b5472e", "#8a6300", "#315f8c", "#6d597a", "#9aa5b1"];
let lang = (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
let names = regionNames();
let applied = { preset: "all", start: null, end: null };
let draft = { preset: "all", start: null, end: null };
let calCursor = null;
let countryRows = null;
let countryAt = 0;
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
  document.getElementById("range-cancel").textContent = t("cancel");
  document.getElementById("range-apply").textContent = t("apply");
  document.getElementById("cal-prev").textContent = "‹";
  document.getElementById("cal-next").textContent = "›";
  document.querySelectorAll("[data-close]").forEach((button) => { button.textContent = t("close"); });
  if (!document.querySelector(".hit")) document.getElementById("wait").textContent = t("waiting");
  paintRange();
}

function utcToday() { return new Date().toISOString().slice(0, 10); }
function addDays(day, count) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
function presetRange(id) {
  const today = utcToday();
  if (id === "all") return { preset: "all", start: null, end: null };
  if (id === "today") return { preset: "today", start: today, end: today };
  if (id === "yesterday") {
    const day = addDays(today, -1);
    return { preset: "yesterday", start: day, end: day };
  }
  if (id === "7" || id === "30" || id === "90") return { preset: id, start: addDays(today, 1 - Number(id)), end: today };
  const now = new Date();
  if (id === "month") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
    return { preset: "month", start, end: today };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { preset: "lastMonth", start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
function rangeText(state) {
  if (!state.start || state.preset === "all") return t("all");
  if (state.preset && state.preset !== "custom") return t(PRESETS.find(([id]) => id === state.preset)?.[1] || "custom");
  return `${state.start} – ${state.end}`;
}
function inRange(day) {
  if (!applied.start) return true;
  return day >= applied.start && day <= applied.end;
}
function sliceSeries(rows) {
  return (rows || []).filter((row) => inRange(String(row.day)));
}
function paintRange() {
  document.getElementById("range-label").textContent = rangeText(applied);
  const presets = document.getElementById("presets");
  presets.innerHTML = PRESETS.map(([id, key]) => (
    `<button type="button" data-preset="${id}" class="${draft.preset === id ? "on" : ""}">${esc(t(key))}</button>`
  )).join("");
  document.getElementById("draft-label").textContent = rangeText(draft);
  paintCal();
}
function monthCells(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const pad = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = Array(pad).fill("");
  for (let day = 1; day <= count; day += 1) cells.push(new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10));
  return cells;
}
function paintCal() {
  const today = utcToday();
  const minDay = (latest && latest.series && latest.series[0] && latest.series[0].day) || "2026-05-06";
  if (!calCursor) {
    const anchor = draft.end || today;
    calCursor = { y: Number(anchor.slice(0, 4)), m: Number(anchor.slice(5, 7)) - 1 };
  }
  const months = [calCursor, { y: calCursor.m === 11 ? calCursor.y + 1 : calCursor.y, m: (calCursor.m + 1) % 12 }];
  const namesOfMonth = new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric", timeZone: "UTC" });
  const letters = lang === "zh" ? [...t("weekdays")] : t("weekdays").match(/.{2}/g);
  document.getElementById("cal-pair").innerHTML = months.map(({ y, m }) => {
    const title = namesOfMonth.format(new Date(Date.UTC(y, m, 1)));
    const days = monthCells(y, m).map((day) => {
      if (!day) return `<span></span>`;
      const disabled = day < minDay || day > today;
      const edge = draft.start && (day === draft.start || day === draft.end);
      const inside = draft.start && draft.end && day > draft.start && day < draft.end;
      return `<button type="button" class="day${edge ? " edge" : ""}${inside ? " in" : ""}" data-day="${day}" ${disabled ? "disabled" : ""}>${Number(day.slice(8))}</button>`;
    }).join("");
    return `<div class="month"><h3>${esc(title)}</h3><div class="week">${letters.map((letter) => `<span>${esc(letter)}</span>`).join("")}</div><div class="days">${days}</div></div>`;
  }).join("");
}
function chooseDay(day) {
  if (!draft.start || draft.preset !== "custom" || draft.start !== draft.end) {
    draft = { preset: "custom", start: day, end: day };
  } else {
    const start = day < draft.start ? day : draft.start;
    const end = day < draft.start ? draft.start : day;
    draft = { preset: "custom", start, end };
  }
  window.setTimeout(paintRange, 0);
}
function openPop() {
  draft = { ...applied };
  calCursor = null;
  document.getElementById("range-pop").hidden = false;
  document.getElementById("range-btn").setAttribute("aria-expanded", "true");
  paintRange();
}
function closePop() {
  document.getElementById("range-pop").hidden = true;
  document.getElementById("range-btn").setAttribute("aria-expanded", "false");
}
function commitRange(next) {
  applied = next;
  draft = { ...next };
  closePop();
  paintRange();
  if (latest) render(latest);
  if (!document.getElementById("sheets").hidden) drawSheets();
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
  const scoped = Boolean(applied.start);
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
    : { top: 76, bottom: 22, left: 16, right: 348 };
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
  const users = applied.start ? sumUV : Number(data.totalUV || sumUV);
  const visits = applied.start ? sumPV : Number(data.totalPV || sumPV);
  setMetric("metric-uv", users, ready, fromPoll);
  setMetric("metric-pv", visits, ready, fromPoll);
  const note = applied.start ? t("window") : t("since");
  document.getElementById("users-note").textContent = note;
  document.getElementById("visits-note").textContent = note;
  sparks.uv = rows.map((row) => Number(row.uv) || 0);
  sparks.pv = rows.map((row) => Number(row.pv) || 0);
  renderLists(data);
  ingest(data.recentLogs || []);
  if (reduced) paintCharts();
  if (!document.getElementById("sheets").hidden) drawSheets();
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

function bucketOf(day, span) {
  if (span <= 42) return day;
  const date = new Date(`${day}T00:00:00Z`);
  const shift = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - shift);
  return date.toISOString().slice(0, 10);
}
function buildStack(key) {
  const rows = (countryRows || []).filter((row) => inRange(String(row.day)) && row.country && row.country !== "XX");
  if (countryRows && countryRows.length && !rows.length) return { countries: [], columns: [], snapshot: false };
  if (!rows.length && latest && latest.countries) {
    const parts = {};
    Object.entries(latest.countries).forEach(([code, info]) => {
      const value = Number(info[key]) || 0;
      if (value > 0) parts[code] = value;
    });
    const ranked = Object.entries(parts).sort((a, b) => b[1] - a[1]);
    const top = ranked.slice(0, 6).map(([code]) => code);
    const folded = {};
    ranked.forEach(([code, value]) => {
      const name = top.includes(code) ? code : "other";
      folded[name] = (folded[name] || 0) + value;
    });
    const countries = top.concat(ranked.length > top.length ? ["other"] : []);
    return { countries, columns: [{ label: t("all"), parts: folded }], snapshot: true };
  }
  const totals = new Map();
  rows.forEach((row) => totals.set(row.country, (totals.get(row.country) || 0) + (Number(row[key]) || 0)));
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 6).map(([code]) => code);
  const days = [...new Set(rows.map((row) => row.day))].sort();
  const span = days.length;
  const grouped = new Map();
  rows.forEach((row) => {
    const label = bucketOf(row.day, span);
    const slot = grouped.get(label) || {};
    const code = top.includes(row.country) ? row.country : "other";
    slot[code] = (slot[code] || 0) + (Number(row[key]) || 0);
    grouped.set(label, slot);
  });
  return {
    countries: top.concat(ranked.length > 6 ? ["other"] : []),
    columns: [...grouped.keys()].sort().map((label) => ({ label: span <= 42 ? label.slice(5) : label.slice(5), parts: grouped.get(label) })),
    snapshot: false,
  };
}
function drawStack(canvas, model) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 20 || h < 20) return;
  canvas.width = Math.floor(w * ratio);
  canvas.height = Math.floor(h * ratio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = "11px IBM Plex Sans, sans-serif";
  const columns = model.columns || [];
  if (!columns.length) {
    ctx.fillStyle = "#5c6b7a";
    ctx.fillText(t("empty"), 12, 24);
    canvas._cols = [];
    return;
  }
  const left = 42;
  const right = 8;
  const top = 8;
  const bottom = h - 22;
  const max = Math.max(...columns.map((column) => model.countries.reduce((sum, code) => sum + (column.parts[code] || 0), 0)), 1);
  ctx.strokeStyle = "rgba(16, 42, 67, .16)";
  ctx.fillStyle = "#5c6b7a";
  for (let step = 0; step <= 4; step += 1) {
    const y = bottom - ((bottom - top) * step) / 4;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(w - right, y);
    ctx.stroke();
    const tick = (max * step) / 4;
    const tickLabel = tick >= 1000 ? `${Math.round(tick / 100) / 10}k`.replace(".0k", "k") : String(Math.round(tick));
    ctx.fillText(tickLabel, 2, y + 3);
  }
  const slot = (w - left - right) / columns.length;
  const gap = Math.min(8, slot * 0.28);
  const boxes = [];
  columns.forEach((column, index) => {
    const x = left + index * slot + gap / 2;
    const width = Math.max(2, slot - gap);
    let y = bottom;
    model.countries.forEach((code) => {
      const value = column.parts[code] || 0;
      if (!value) return;
      const height = ((bottom - top) * value) / max;
      y -= height;
      ctx.fillStyle = code === "other" ? "#c5cdd4" : COLORS[model.countries.indexOf(code) % COLORS.length];
      ctx.fillRect(x, y, width, height);
    });
    boxes.push({ x, width, label: column.label, parts: column.parts });
    if (columns.length <= 16 || index % Math.ceil(columns.length / 8) === 0) {
      ctx.fillStyle = "#5c6b7a";
      ctx.fillText(column.label, x, h - 6);
    }
  });
  canvas._cols = boxes;
  canvas._countries = model.countries;
}
function paintLegend(id, countries) {
  document.getElementById(id).innerHTML = countries.map((code, index) => {
    const color = code === "other" ? "#c5cdd4" : COLORS[index % COLORS.length];
    const label = code === "other" ? t("other") : countryName(code);
    return `<span><i style="background:${color}"></i>${esc(label)}</span>`;
  }).join("");
}
function drawSheets() {
  const users = buildStack("uv");
  const visits = buildStack("pv");
  drawStack(document.getElementById("stack-uv"), users);
  drawStack(document.getElementById("stack-pv"), visits);
  paintLegend("legend-uv", users.countries);
  paintLegend("legend-pv", visits.countries);
  const note = `${rangeText(applied)} · ${t("stackHint")}`;
  document.getElementById("sheet-uv-note").textContent = note;
  document.getElementById("sheet-pv-note").textContent = note;
}
async function loadCountries() {
  if (countryRows && Date.now() - countryAt < 20000) {
    drawSheets();
    return;
  }
  try {
    const response = await fetch("/api/stats?view=countries", { cache: "no-store" });
    const data = await response.json();
    countryRows = data.countrySeries || [];
    countryAt = Date.now();
  } catch (e) {
    countryRows = countryRows || [];
  }
  drawSheets();
}
function openSheets() {
  document.getElementById("sheets").hidden = false;
  document.getElementById("sheet-uv").hidden = false;
  document.getElementById("sheet-pv").hidden = false;
  loadCountries();
}
function closeSheet(which) {
  document.getElementById(which === "uv" ? "sheet-uv" : "sheet-pv").hidden = true;
  if (document.getElementById("sheet-uv").hidden && document.getElementById("sheet-pv").hidden) {
    document.getElementById("sheets").hidden = true;
  }
}
function showTip(event, canvas) {
  const tip = document.getElementById("stack-tip");
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const column = (canvas._cols || []).find((box) => x >= box.x && x <= box.x + box.width);
  if (!column) {
    tip.hidden = true;
    return;
  }
  const lines = (canvas._countries || []).map((code) => {
    const value = column.parts[code] || 0;
    if (!value) return "";
    const label = code === "other" ? t("other") : countryName(code);
    return `<div>${esc(label)} ${num(value)}</div>`;
  }).join("");
  tip.innerHTML = `<b>${esc(column.label)}</b>${lines}`;
  tip.hidden = false;
  tip.style.left = `${Math.min(event.clientX + 12, window.innerWidth - 230)}px`;
  tip.style.top = `${event.clientY + 12}px`;
}

document.getElementById("range-btn").addEventListener("click", () => {
  if (document.getElementById("range-pop").hidden) openPop();
  else closePop();
});
document.getElementById("range-pop").addEventListener("click", (event) => {
  const preset = event.target.closest("[data-preset]");
  if (preset) {
    commitRange(presetRange(preset.dataset.preset));
    return;
  }
  const day = event.target.closest("[data-day]");
  if (day && !day.disabled) chooseDay(day.dataset.day);
});
document.getElementById("cal-prev").addEventListener("click", () => {
  calCursor = { y: calCursor.m === 0 ? calCursor.y - 1 : calCursor.y, m: (calCursor.m + 11) % 12 };
  paintCal();
});
document.getElementById("cal-next").addEventListener("click", () => {
  calCursor = { y: calCursor.m === 11 ? calCursor.y + 1 : calCursor.y, m: (calCursor.m + 1) % 12 };
  paintCal();
});
document.getElementById("range-cancel").addEventListener("click", closePop);
document.getElementById("range-apply").addEventListener("click", () => commitRange({ ...draft }));
document.getElementById("open-metrics").addEventListener("click", openSheets);
document.getElementById("open-metrics-pv").addEventListener("click", openSheets);
document.getElementById("sheets").addEventListener("click", (event) => {
  const button = event.target.closest("[data-close]");
  if (button) closeSheet(button.dataset.close);
});
["stack-uv", "stack-pv"].forEach((id) => {
  const canvas = document.getElementById(id);
  canvas.addEventListener("mousemove", (event) => showTip(event, canvas));
  canvas.addEventListener("mouseleave", () => { document.getElementById("stack-tip").hidden = true; });
});
document.addEventListener("click", (event) => {
  const pop = document.getElementById("range-pop");
  if (pop.hidden) return;
  if (event.target.closest("#range-pop") || event.target.closest("#range-btn") || event.target.closest(".cal-nav")) return;
  closePop();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!document.getElementById("range-pop").hidden) closePop();
  else closeSheet("uv"), closeSheet("pv");
});
document.getElementById("lang").addEventListener("click", () => {
  lang = lang === "zh" ? "en" : "zh";
  applyCopy();
  if (latest) render(latest);
  if (!document.getElementById("sheets").hidden) drawSheets();
});
window.addEventListener("resize", () => {
  if (map) {
    map.resize();
    frameWorld();
  }
  if (!document.getElementById("sheets").hidden) drawSheets();
});
applyCopy();
stamp();
setInterval(stamp, 1000);
initMap();
paintCharts();
refresh();
setInterval(refresh, 3000);
