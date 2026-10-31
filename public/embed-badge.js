(function () {
  var container = document.getElementById("gid-live-stats-widget");
  if (!container) return;
  var scriptEl = document.currentScript;
  var base = (scriptEl && scriptEl.getAttribute("data-api")) || "https://stats.globalinfectiousdisease.com";
  var zh = (document.documentElement.lang || "").toLowerCase().indexOf("zh") === 0;
  var labels = zh
    ? ["过去 5 分钟", "用户", "浏览量", "自动访问"]
    : ["Last 5 min", "Users", "Views", "Automated"];

  container.innerHTML = ''
    + '<div style="font-family:IBM Plex Sans,Segoe UI,sans-serif;background:#fff;border:1px solid #e1e5ea;border-radius:12px;padding:16px 18px;color:#1b2430;max-width:720px;">'
    + '<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;margin-bottom:12px;">'
    + '<strong style="font-size:14px;">GIDS Analytics</strong>'
    + '<a href="' + base + '" style="color:#0f766e;font-size:12px;font-weight:600;text-decoration:none;">' + (zh ? "打开报告" : "Open report") + "</a>"
    + "</div>"
    + '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;">'
    + labels.map(function (label, i) {
      return '<div><div style="color:#5c6b7a;font-size:11px;">' + label + '</div><div id="gid-b-' + i + '" style="font-size:22px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:2px;">—</div></div>';
    }).join("")
    + "</div></div>";

  fetch(base + "/api/stats")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var live = d && d.configured && d.ok;
      var values = live ? [d.onlineCount || 0, d.totalUV || 0, d.totalPV || 0, d.filteredBots || 0] : ["—", "—", "—", "—"];
      values.forEach(function (value, i) {
        var el = document.getElementById("gid-b-" + i);
        if (el) el.textContent = typeof value === "number" ? value.toLocaleString() : value;
      });
    })
    .catch(function () {});
})();
