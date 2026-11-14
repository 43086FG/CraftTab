# Privacy Policy · 隐私政策

CraftTab · 作者 / Author: 43086FG · 联系 / Contact: fg43086@outlook.com
最后更新 / Last updated: 2026-11-13

---

## 中文

### 概述

CraftTab 是一个 Minecraft 风格的新标签页扩展。我们不收集、不上传、不出售任何个人数据，扩展内没有统计、广告或遥测组件。

### 本地保存的数据

以下内容仅保存在你的设备上（`chrome.storage.local` 或浏览器 IndexedDB），不会发送到任何服务器：

- 设置项：语言、壁纸选择、音量与声音开关、玩家名、默认搜索引擎等。
- 搜索历史，以及小组件与分类（含自定义名称和图标）。
- 壁纸文件与导入的 `.mcpack` / `.zip` 资源包。
- 备份文件只有在你主动导出时才会生成到你选择的位置。

扩展**不读取、不存储书签**，也未申请书签、历史记录、标签页或 Cookie 权限。

### 网络请求

扩展唯一的外部网络请求用于「小组件图标抓取」：

- 仅在你打开小组件编辑面板并使用图标抓取时发起。
- 请求由浏览器直接发往目标网站（获取 favicon / manifest）或公共图标服务（Google s2、DuckDuckGo）。
- 请求只用于获取图片，不携带你的身份信息，不经过作者自建服务器。
- 抓取失败时回退到内置占位贴图或你手动上传的图标。

### 权限用途

- `storage`：保存上述设置与小组件数据。
- `unlimitedStorage`：让视频壁纸和资源包可以存放在本地 IndexedDB。
- `identity`：读取浏览器账户显示名作为玩家名默认值；仅本地使用，可留空。
- `host_permissions`（http/https）：仅用于抓取网站图标。

### 用户控制

- 可在设置页清空搜索历史、重置所有设置、导出或导入备份。
- 卸载扩展或在浏览器中清除扩展数据，即可删除全部本地数据。

### 第三方

图标抓取可能访问 Google s2、DuckDuckGo 等公共 favicon 服务，其请求受对应服务的隐私政策约束。本项目不含任何第三方分析或广告组件。

### 变更与联系

如隐私实践发生变化，我们会更新本页面并修改「最后更新」日期。隐私相关问题请联系 fg43086@outlook.com。

---

## English

### Overview

CraftTab is a Minecraft-style new tab extension. We do not collect, upload or sell any personal data, and the extension contains no analytics, advertising or telemetry components.

### Data stored on your device

The following stays on your device only (`chrome.storage.local` or browser IndexedDB) and is never sent to a server:

- Settings: language, wallpaper choice, volume and sound toggle, player name, default search engine.
- Search history, widgets and categories (including custom names and icons).
- Wallpaper files and imported `.mcpack` / `.zip` resource packs.
- Backup files are created only when you explicitly export them to a location you choose.

The extension **does not read or store bookmarks**, and it does not request bookmarks, history, tabs or cookies permissions.

### Network requests

The only external requests are made for widget icon fetching:

- They happen only when you open the widget editor and use icon fetching.
- Requests go directly from your browser to the target website (favicon / manifest) or to public icon services (Google s2, DuckDuckGo).
- They are used to retrieve images only, carry no identity information, and never pass through an author-operated server.
- If fetching fails, the extension falls back to a built-in placeholder texture or an icon you upload manually.

### Why each permission is needed

- `storage`: saves the settings and widget data listed above.
- `unlimitedStorage`: lets video wallpapers and resource packs live in local IndexedDB.
- `identity`: reads the browser account display name as the default player name; used locally only and may be left empty.
- `host_permissions` (http/https): used solely for fetching website icons.

### Your control

- Clear search history, reset all settings, or export / import a backup from the settings page.
- Uninstalling the extension or clearing its data in the browser removes everything stored locally.

### Third parties

Icon fetching may contact public favicon services such as Google s2 and DuckDuckGo; those requests are subject to their own privacy policies. This project contains no third-party analytics or advertising.

### Changes and contact

If our privacy practices change, we will update this page and its "Last updated" date. For privacy questions, contact fg43086@outlook.com.
