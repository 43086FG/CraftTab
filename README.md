# CraftTab

Minecraft 基岩版风格的新标签页扩展（Edge / Chrome，Manifest V3，原生 HTML/CSS/JS，无构建依赖）。

作者：43086FG · fg43086@outlook.com

## 功能

- 主界面：原版风格主菜单（搜索 / 设置 / 小组件）、可编辑玩家名。
- 壁纸：默认壁纸、本地图片、视频壁纸；音量滑杆、声音开关；切标签/关页自动停播；多标签页音频互斥。
- 搜索：多引擎（Bing / Google / Baidu / DuckDuckGo / Yandex / 360）、搜索历史。
- 小组件物品栏：17 列网格、分类页签（右键编辑）、快捷栏、拖拽增删、图标抓取与手动上传。
- 设置页：常规设置、壁纸、语言（简体中文 / 繁體中文 / English / 日本語 / 한국어 / Español / Русский / Français）、全局资源、小组件、重置与备份、关于。
- 全局资源包：导入 `.kzpack` 覆盖 UI 贴图、字体、文案与主题；启用 / 停用 / 排序 / 删除；导入立即生效并持久保存。
- 所有贴图缺失时统一回退到紫黑 missing 贴图。

## 安装

1. 下载 Release 中的 `MCNewTab-*.zip` 并解压。
2. 打开 `edge://extensions` 或 `chrome://extensions`，开启「开发人员模式」。
3. 点击「加载解压缩的扩展」，选择解压后的目录。
4. 新开标签页即可看到 CraftTab。

也可以在扩展管理页把签名好的 `.crx` 拖入窗口安装（部分浏览器会限制非商店来源的 crx，此时请用 zip 方式）。

## 目录结构

```
src/                扩展源码（可直接加载）
  manifest.json
  newtab.html
  settings.html
  background.js     图标抓取后台
  css/ js/
  assets/           贴图、字体、默认壁纸
  icons/            扩展图标
  texts/            8 种语言 .lang
  packs/default/    内置默认资源包（Minecraft 目录结构）
  packs/README.md   资源包规范
build/
  build.ps1         打包脚本（生成 dist/ 下的 zip 与可选 crx）
README.md
LICENSE
```

## 打包

```powershell
powershell -ExecutionPolicy Bypass -File build/build.ps1
```

脚本会把 `src/` 复制到 `dist/MCNewTab/`，按引用裁剪未使用的贴图，并生成 `dist/MCNewTab.zip`。
如需签名 crx（crx3）：

```powershell
npx crx3 -p privatekey.pem -o dist/MCNewTab.crx dist/MCNewTab
```

`.pem` 私钥仅本地保存，已在 `.gitignore` 中排除，**不要提交到仓库**。升级 crx 必须复用同一把私钥。

## `.kzpack` 资源包格式

`.kzpack` 是 zip 改后缀，根目录结构：

```
manifest.json
pack_icon.png
textures/ui/*.png      可覆盖 UI 贴图（title.png、toggle_on.png、indent.png 等）
font/main.ttf          可选：替换界面字体
texts/zh_CN.lang       可选：按语言增量覆盖文案
ui/theme.json          可选：主题 CSS 变量
```

`manifest.json`：

```json
{
  "format_version": 1,
  "header": {
    "name": "示例资源包",
    "description": "替换主菜单 LOGO 颜色",
    "version": [1, 0, 0],
    "uuid": "2b7d9c10-6f2e-4b5a-9c31-8d7e6f5a4b3c",
    "author": "43086FG"
  }
}
```

规则：

- `header.name`、`header.uuid`、`header.version` 必填；相同 `uuid` 重新导入会覆盖旧包。
- 列表位置越高的包优先级越高，最下方是内置 `Default` 包。
- 只覆盖包内实际存在的文件；`texts/*.lang` 为增量覆盖，不会清空未写的 key。
- 贴图按逻辑文件名匹配，例如 `textures/ui/title.png` 替换主界面 LOGO。
- 完整的可覆盖贴图清单见 [src/packs/README.md](src/packs/README.md)。

## 致谢与素材版权

- 界面风格与部分贴图取自 Minecraft 基岩版原版资源包；Minecraft 及相关素材版权归 Mojang Studios / Microsoft 所有。
- 本项目是非官方的个人开源项目，与 Mojang / Microsoft 无关联；使用前请确保你拥有 Minecraft 的正版授权，请勿将素材用于商业用途。
- 图标抓取参考了公共 favicon 服务（Google s2、DuckDuckGo）。
- 感谢 Minecraft 社区长期沉淀的 UI 设计经验与开源工具生态。
