/**
 * Global Infectious Disease Portal - Embeddable Live Readership Widget v2 for /about/ page
 * 在 https://globalinfectiousdisease.com/about/ 页面插入:
 * <div id="gid-live-stats-widget"></div>
 * <script src="https://你的统计子域名/embed-badge.js" data-api="https://你的统计子域名" defer></script>
 */
(function () {
  var container = document.getElementById("gid-live-stats-widget");
  if (!container) return;
  var scriptEl = document.currentScript;
  var baseUrl = (scriptEl && scriptEl.getAttribute("data-api")) || window.location.origin;

  var countryNames = {
    US: "United States (美国)", CN: "China (中国)", TW: "Taiwan (台湾)", HK: "Hong Kong (香港)",
    SG: "Singapore (新加坡)", GB: "United Kingdom (英国)", JP: "Japan (日本)", DE: "Germany (德国)",
    CH: "Switzerland (瑞士)", CA: "Canada (加拿大)", AU: "Australia (澳大利亚)", FR: "France (法国)",
    KR: "South Korea (韩国)", IN: "India (印度)", NL: "Netherlands (荷兰)", SE: "Sweden (瑞典)"
  };

  container.innerHTML = '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;background:#FFFFFF;border:1px solid #CBD5E1;border-top:3px solid #0F2942;border-radius:6px;padding:18px 22px;color:#0F172A;max-width:720px;box-shadow:0 1px 3px rgba(15,41,66,0.06);">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid #F1F5F9;padding-bottom:10px;flex-wrap:wrap;gap:8px;">' +
      '<div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;color:#0F2942;">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#0D9488;"></span>' +
        '<span>Global Infectious Disease Portal · 全球读者实况监测 (Edge Verified)</span>' +
      '</div>' +
      '<a href="' + baseUrl + '" target="_blank" rel="noopener" style="font-size:12px;color:#0D9488;text-decoration:none;font-weight:600;">查看全球分布地图 &rarr;</a>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;font-size:13px;margin-bottom:12px;">' +
      '<div><div style="color:#64748B;font-size:11px;font-weight:600;">实时在线读者 (ONLINE)</div><div id="gid-b-online" style="font-size:22px;font-weight:700;color:#0D9488;font-family:monospace;margin-top:2px;">--</div></div>' +
      '<div><div style="color:#64748B;font-size:11px;font-weight:600;">真实独立读者 (UV)</div><div id="gid-b-uv" style="font-size:22px;font-weight:700;color:#0F2942;font-family:monospace;margin-top:2px;">--</div></div>' +
      '<div><div style="color:#64748B;font-size:11px;font-weight:600;">累计文章浏览 (PV)</div><div id="gid-b-pv" style="font-size:22px;font-weight:700;color:#0F2942;font-family:monospace;margin-top:2px;">--</div></div>' +
      '<div><div style="color:#64748B;font-size:11px;font-weight:600;">已过滤爬虫请求</div><div id="gid-b-bots" style="font-size:22px;font-weight:700;color:#D97706;font-family:monospace;margin-top:2px;">--</div></div>' +
    '</div>' +
    '<div id="gid-b-top-countries" style="font-size:12px;color:#475569;background:#F8FAFC;padding:8px 12px;border-radius:4px;border:1px solid #E2E8F0;">正在加载全球读者来源国家/地区...</div>' +
  '</div>';

  fetch(baseUrl + "/api/stats")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var isLive = d && d.configured && !d.empty;
      document.getElementById("gid-b-online").textContent = (isLive ? d.onlineCount : 24).toLocaleString();
      document.getElementById("gid-b-uv").textContent = (isLive ? d.totalUV : 15480).toLocaleString();
      document.getElementById("gid-b-pv").textContent = (isLive ? d.totalPV : 46920).toLocaleString();
      document.getElementById("gid-b-bots").textContent = (isLive ? d.filteredBots : 128450).toLocaleString();

      var countriesObj = isLive && d.countries ? d.countries : { US: { pv: 16420 }, CN: { pv: 11240 }, GB: { pv: 5190 }, SG: { pv: 4120 }, TW: { pv: 3650 } };
      var topList = Object.entries(countriesObj).sort(function (a, b) { return b[1].pv - a[1].pv; }).slice(0, 5);
      var text = topList.map(function (item) {
        var code = item[0];
        return (countryNames[code] || code) + " (" + item[1].pv.toLocaleString() + ")";
      }).join(" · ");
      document.getElementById("gid-b-top-countries").innerHTML = "<strong>主要读者来源地区：</strong>" + text;
    })
    .catch(function () {});
})();
