# CraftTab v1.0.1

发布日期 · Released: 2026-11-14

## 中文

### 图标抓取
- 槽位图标改为纯前端 `<img>` 加载链路：站点 `/favicon.ico` 优先，`favicon.im`、`favicon.yandex.net` 依次兜底，DuckDuckGo 与 Google s2 仅作最后备选；不再依赖扩展后台或被墙服务作为主路径。
- 扩展环境与静态预览页共用同一套逻辑：无 `chrome.runtime` 时自动走纯前端路径。
- 去掉 32px 尺寸下限，16px 小图标、SVG 图标与 301/302 跳转均可正常显示。
- 新增逐图标加载日志（控制台 `[icon]` 前缀，含每个 URL 的成功/超时/失败与最终来源）；地址栏加 `?iconDebug=1` 或执行 `localStorage.setItem('mcIconDebug','1')` 后，槽位右上角显示来源角标。`window.mcIconReport()` 可导出汇总。

### 物品栏
- 右侧新增原版风格竖向滚动条：浅灰滑道 + 像素描边滑块，可拖动、可点击轨道跳转，与网格间距对齐。
- 分类页签配色修正：鼠标悬停为绿色填充 + 白边白字，选中态为灰色，未选中为默认深灰。
- 悬停提示仅在鼠标停留时显示，跟随光标并做边缘约束。

### 设置页 / 关于
- 「关于」新增版本号行，以及两行版权说明：贴图来源于 Minecraft Bedrock / 贴图版权归属于 Mojang Studio（8 种语言均已补齐，无裸 key）。

### 资源包
- 导入格式改为 `.mcpack` / `.zip`，移除 `.kzpack` 相关校验与文案；示例包重新产出为 `MCNewTab-示例资源包.mcpack`（附同内容 `.zip`）。

### 其他
- 解压状态在 Edge 中验证：版本读取 1.0.1、页面可用、控制台无错误、图标与资源包导入均正常。

## English

### Icon fetching
- Slot icons now use a pure front-end `<img>` chain: site `/favicon.ico` first, then `favicon.im` and `favicon.yandex.net`, with DuckDuckGo and Google s2 only as last resorts. No background-script or blocked-service dependency on the primary path.
- The same logic runs in both extension and static preview environments.
- Removed the 32px minimum size, so 16px icons, SVGs and 301/302 redirects all render.
- Per-icon loading logs (`[icon]` prefix) report every URL's success/timeout/error and the final source. Add `?iconDebug=1` or run `localStorage.setItem('mcIconDebug','1')` to show a source badge in each slot; `window.mcIconReport()` returns a summary.

### Inventory
- Added the original-style vertical scrollbar on the right: light track with pixel-bordered thumb, draggable, track-click to jump, aligned with the grid spacing.
- Fixed category tab colors: green fill with white border and text on hover, gray when selected, dark gray by default.

### Settings / About
- About now shows the version plus two separate copyright lines (textures from Minecraft Bedrock; textures copyright Mojang Studios), localized in all eight languages.

### Resource packs
- Import format is now `.mcpack` / `.zip`; all `.kzpack` handling and copy were removed. The sample pack ships as `MCNewTab-示例资源包.mcpack` with an equivalent `.zip`.

### Misc
- Verified in Edge from the unpacked package: version 1.0.1, pages load, no console errors, icons and resource-pack import work.

作者 · Author: 43086FG · fg43086@outlook.com
许可 · License: MIT（代码 / code）；Minecraft 素材版权归 Mojang Studios / Microsoft。
