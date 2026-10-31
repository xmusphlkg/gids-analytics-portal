# Global Infectious Disease Portal - Cloudflare 实时访客与国家监测独立项目 (v2.0 生产加固版)

本版本（v2.0）已完整修复第一版中的所有架构与显示隐患：
1. **双存储引擎自适应（支持 Cloudflare D1 SQL 原子数据库 + 优化版 Workers KV）**：
   - **强烈推荐绑定 Cloudflare D1 (`GID_DB`)**：每天免费 **100,000 次写入**，采用原生 SQL `UPDATE ... SET pv = pv + 1` 原子操作，彻底解决高并发下的数据覆盖（Race Condition）与 KV 每日 1,000 次写入额度限制。**并且代码内置了首次请求自动建表逻辑，你无需手动运行任何 SQL 命令！**
   - **完全兼容 Workers KV (`GID_STATS_KV`)**：如果你依然喜欢用 KV，v2 版本已将每次访问的 KV 写入次数砍半，加上了客户端 15 秒同页面防刷节流，并修复了跨天重复累加总 UV 的问题。
2. **修复地区识别与多城市地图展示**：
   - 新增 **世界各大洲矢量陆地轮廓底图**，不再是空白网格。
   - 新增 **多城市坐标独立保留机制 (`city_nodes`)**：同一国家的不同城市（如北京、上海、台北、亚特兰大、波士顿、伦敦、牛津）会同时在地图上独立闪烁，不再互相覆盖。
   - 内置 **中英双语国家/地区名称与国旗映射字典**（自动将 `US`、`CN`、`TW`、`HK`、`SG` 等代码转化为 `🇺🇸 美国 (US)`、`🇹🇼 台湾 (TW)` 等直观显示），并在页面底部附带了严谨的 VPN/跨境科研专线出口归属说明。
3. **修复跨域（CORS）与爬虫统计机制**：
   - `tracker.js` 改用 `text/plain` 发送 Simple Request，彻底省去浏览器 `OPTIONS` 预检请求，上报速度提升一倍。
   - 结合 Cloudflare 边缘 `request.cf.botManagement.score`、数据中心 ASN 识别以及 `<noscript>` 1x1 像素探针 (`/api/track?pixel=1`)，真实捕获并统计自动化爬虫与脚本请求。

---

## 一、如何直接部署上线？（只需 3 步）

### 第一步：在 Cloudflare 控制台创建 D1 数据库（耗时 20 秒）
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 左侧菜单点击 **Storage & Databases (存储和数据库)** -> **D1 SQL Database**。
3. 点击 **Create database (创建数据库)**，输入名称 `gid-telemetry-db` 并点击创建。（无需手动建表，后端程序会在收到第一条访问时自动初始化所有数据表！）

### 第二步：创建 Cloudflare Pages 项目
1. 将解压后的 `gid-analytics-portal-v2` 文件夹上传到你的 GitHub 仓库。
2. 在 Cloudflare 左侧菜单进入 **Compute (Workers) / Workers & Pages** -> 点击 **Create** -> 切换到 **Pages** -> **Connect to Git**。
3. 选择你的仓库，填写构建设置：
   - **Project name**: `gid-analytics-portal`
   - **Build command**: 留空不填
   - **Build output directory**: 填写 `public`
4. 点击 **Save and Deploy**。

### 第三步：绑定 `GID_DB` 数据库与自定义域名
1. 进入刚创建的 Pages 项目 -> **Settings (设置)** -> **Bindings (绑定)** -> 点击 **Add** -> 选择 **D1 database**：
   - **Variable name (变量名)**: 必须填写 `GID_DB`
   - **D1 database**: 选择刚刚创建的 `gid-telemetry-db`，点击保存。
   *(注：如果你想用 KV 而不是 D1，则在此处选择绑定 KV namespace，变量名填 `GID_STATS_KV` 即可。)*
2. 进入 **Custom domains (自定义域)**，绑定你的子域名（例如 `stats.globalinfectiousdisease.com`）。
3. 在 **Deployments** 页面点击最新一条部署右侧的 **Retry deployment (重新部署)** 让绑定生效，即可正式上线！

---

## 二、在主站 `globalinfectiousdisease.com` 中接入代码

假设你的统计子站域名为 `https://stats.globalinfectiousdisease.com`：

### 1. 在主站全局模板（Header 或 Footer）加入真实访问上报与爬虫探针：
```html
<script defer src="https://stats.globalinfectiousdisease.com/tracker.js" data-endpoint="https://stats.globalinfectiousdisease.com/api/track"></script>
<noscript><img src="https://stats.globalinfectiousdisease.com/api/track?pixel=1&path=/noscript" alt="" width="1" height="1" style="display:none;" /></noscript>
```

### 2. 在主站 `https://globalinfectiousdisease.com/about/` 页面正文中嵌入实时数据卡片：
```html
<div id="gid-live-stats-widget"></div>
<script defer src="https://stats.globalinfectiousdisease.com/embed-badge.js" data-api="https://stats.globalinfectiousdisease.com"></script>
```
