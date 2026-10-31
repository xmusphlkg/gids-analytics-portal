# GIDS Analytics

Audience report for [globalinfectiousdisease.com](https://globalinfectiousdisease.com/), served at `stats.globalinfectiousdisease.com`.

Readership is stored in Cloudflare D1 `gid-telemetry-db` and bound to the Pages project as `GID_DB`. The report shows active users, users, views, places, and pages. It does not fill in sample numbers.

Add this to the public site template:

```html
<script defer src="https://stats.globalinfectiousdisease.com/tracker.js" data-endpoint="https://stats.globalinfectiousdisease.com/api/track"></script>
```

Optional badge:

```html
<div id="gid-live-stats-widget"></div>
<script defer src="https://stats.globalinfectiousdisease.com/embed-badge.js" data-api="https://stats.globalinfectiousdisease.com"></script>
```
