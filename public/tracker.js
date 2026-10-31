/**
 * Global Infectious Disease Portal - Real-User & Edge Telemetry Beacon v2 (tracker.js)
 * 【v2 升级】
 * 1. 使用 text/plain Content-Type 发送 Simple Request，彻底省去浏览器 OPTIONS 预检请求
 * 2. 内置同一页面 15 秒防抖节流，防止用户连续按 F5 刷爆写入额度
 */
(function () {
  try {
    var scriptEl = document.currentScript;
    var endpoint = (scriptEl && scriptEl.getAttribute("data-endpoint")) || (window.location.origin + "/api/track");
    var pageKey = "gid_last_track_" + window.location.pathname;
    var now = Date.now();
    try {
      var lastTs = parseInt(sessionStorage.getItem(pageKey) || "0", 10);
      if (now - lastTs < 15000) return; // 15秒内同页面重复刷新不重复计费写入
      sessionStorage.setItem(pageKey, String(now));
    } catch (e) {}

    var payload = JSON.stringify({
      path: window.location.pathname + window.location.search,
      title: document.title,
      referrer: document.referrer || "Direct",
      webdriver: !!navigator.webdriver,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || ""
    });

    if (navigator.sendBeacon) {
      // 使用 text/plain 避免触发 CORS Preflight OPTIONS 请求
      var blob = new Blob([payload], { type: "text/plain;charset=UTF-8" });
      navigator.sendBeacon(endpoint, blob);
    } else {
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: payload,
        keepalive: true,
        mode: "cors"
      }).catch(function () {});
    }
  } catch (e) {}
})();
