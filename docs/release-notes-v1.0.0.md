# CraftTab v1.0.0

首个正式发行版：Minecraft 基岩版风格的 Edge / Chrome 新标签页。
First public release: a Minecraft Bedrock-style new tab for Edge and Chrome.

## 主要能力 · Highlights

- 基岩版风格新标签页：主菜单、像素化控件、可编辑玩家名。
  Bedrock-style new tab with a pixel main menu and editable player name.
- 物品栏网格与独立 9 格快捷栏：分类页签、拖拽增删、自定义图标。
  Widget inventory grid with a separate 9-slot hotbar, category tabs, drag to add/remove and custom icons.
- 小组件图标抓取：后台解析网页 favicon / manifest，解码校验尺寸，失败可手动上传。
  Widget icon fetching from favicon / web-manifest with size validation and manual upload fallback.
- 视频壁纸与音量控制：音量滑杆、声音开关；切标签/关页静音停播，多标签页音频互斥。
  Video wallpapers with volume and sound controls; playback mutes on hide/close and only one tab is audible.
- 8 种语言：简体中文、繁體中文、English、日本語、한국어、Español、Русский、Français，切换即时生效。
  Eight languages, switched live across new tab and settings.
- `.kzpack` 资源包：导入即可覆盖贴图 / 字体 / 文案，支持启用、停用、排序与删除，列表位置越高优先级越高，底部为内置 `Default` 包。
  `.kzpack` resource packs override textures, fonts and texts, with enable/disable, reordering and deletion; higher entries win, `Default` sits at the bottom.
- 设置页模块：常规设置、壁纸、语言、全局资源、小组件、重置与备份、关于。
  Settings modules: General, Wallpaper, Language, Global Resources, Widgets, Reset & Backup, About.

## 安装 · Installation

- **zip（推荐 / recommended）**：解压后在 `edge://extensions` 或 `chrome://extensions` 开启开发人员模式，点「加载解压缩的扩展」选择目录。
  Extract the zip, enable Developer mode, then use "Load unpacked" and pick the folder.
- **crx**：直接把 `.crx` 拖入扩展管理页；若浏览器限制非商店来源，请改用 zip。
  Drag the `.crx` into the extensions page; if the browser blocks non-store installs, use the zip.

## 版本要求 · Requirements

- Microsoft Edge 88+ 或 Google Chrome 88+（Manifest V3），建议使用最新版本。
- Edge 88+ or Chrome 88+ with Manifest V3 support; latest stable recommended.

## 资源包示例 · Sample pack

`MCNewTab-示例资源包.kzpack` 导入后会改变主菜单 LOGO 颜色与设置按钮文案；结构说明见仓库中的 `src/packs/README.md`。
The sample `.kzpack` recolors the main menu logo and changes the settings label after import; see `src/packs/README.md` for the format.

作者 · Author: 43086FG · fg43086@outlook.com
许可 · License: MIT（代码 / code）；Minecraft 素材版权归 Mojang Studios / Microsoft。
