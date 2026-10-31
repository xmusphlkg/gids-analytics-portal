(function () {
  try {
    var scriptEl = document.currentScript;
    var endpoint = (scriptEl && scriptEl.getAttribute("data-endpoint")) || (window.location.origin + "/api/track");
    var pageKey = "gid_last_track_" + window.location.pathname;
    var now = Date.now();
    try {
      var lastTs = parseInt(sessionStorage.getItem(pageKey) || "0", 10);
      if (now - lastTs < 15000) return;
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
      navigator.sendBeacon(endpoint, new Blob([payload], { type: "text/plain;charset=UTF-8" }));
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
