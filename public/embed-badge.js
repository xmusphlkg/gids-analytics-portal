(function () {
  var container = document.getElementById("gid-live-stats-widget");
  if (!container) return;
  var scriptEl = document.currentScript || document.querySelector("script[src*='embed-badge'][data-api]");
  var base = (scriptEl && scriptEl.getAttribute("data-api")) || "https://stats.globalinfectiousdisease.com";
  var lang = (document.documentElement.lang || "").toLowerCase();
  var zh = lang.indexOf("zh") === 0;
  var fr = lang.indexOf("fr") === 0;
  var copy = zh
    ? { report: "统计报告", metrics: ["过去 5 分钟", "累计用户", "累计访问", "自动访问"] }
    : fr
      ? { report: "Rapport d’audience", metrics: ["5 dernières min", "Lecteurs", "Visites", "Automatiques"] }
      : { report: "Audience report", metrics: ["Last 5 min", "Readers", "Visits", "Automated"] };

  if (!container.querySelector("[data-gid-metric]")) {
    var hero = document.querySelector(".about-hero");
    var slot = container.closest(".audience-slot");
    if (hero && slot && !hero.contains(slot)) {
      hero.appendChild(slot);
      hero.style.paddingBottom = "clamp(1.35rem, 3vw, 2rem)";
      slot.style.marginTop = "0";
    }
    if (!document.getElementById("gid-audience-style")) {
      var style = document.createElement("style");
      style.id = "gid-audience-style";
      style.textContent = [
        ".gid-audience{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem 1.5rem;margin:clamp(1.75rem,4vw,2.75rem) 0 0;padding-top:1rem;border-top:1px solid rgb(var(--border));background:transparent;color:inherit;font-family:inherit;max-width:none;border-radius:0;box-shadow:none}",
        ".gid-audience p{margin:0;color:rgb(var(--text-muted));font-size:.68rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}",
        ".gid-audience strong{display:block;margin-top:.28rem;color:rgb(var(--text-strong));font-size:clamp(1.45rem,2.2vw,1.85rem);font-weight:650;font-variant-numeric:tabular-nums;letter-spacing:-.03em;line-height:1.05}",
        ".gid-audience a{grid-column:1/-1;justify-self:start;color:rgb(var(--color-teal));font-size:.75rem;font-weight:700;text-decoration:underline;text-underline-offset:3px}",
        "@media(min-width:760px){.gid-audience{grid-template-columns:repeat(4,minmax(0,1fr)) auto;align-items:end;column-gap:2rem}.gid-audience a{grid-column:auto;justify-self:end;margin-bottom:.15rem}}"
      ].join("");
      document.head.appendChild(style);
    }
    container.className = "gid-audience";
    container.innerHTML = copy.metrics.map(function (label, index) {
      return "<div><p>" + label + "</p><strong data-gid-metric=\"" + index + "\">—</strong></div>";
    }).join("") + "<a href=\"" + base.replace(/"/g, "") + "/\">" + copy.report + " <span aria-hidden=\"true\">↗</span></a>";
  }

  function paint() {
    fetch(base + "/api/stats", { cache: "no-store" })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        var live = data && data.configured && data.ok !== false;
        var values = live
          ? [data.onlineCount || 0, data.totalUV || 0, data.totalPV || 0, data.filteredBots || 0]
          : ["—", "—", "—", "—"];
        values.forEach(function (value, index) {
          var el = container.querySelector("[data-gid-metric=\"" + index + "\"]");
          if (!el) return;
          el.textContent = typeof value === "number" ? value.toLocaleString(document.documentElement.lang || undefined) : value;
        });
      })
      .catch(function () {});
  }

  paint();
  setInterval(paint, 20000);
})();
