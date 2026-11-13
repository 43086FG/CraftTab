# 资源包（.kzpack）说明

资源包目录结构直接沿用 Minecraft 基岩版资源包的写法，内层至少要有根目录的 `manifest.json`。

```
my-pack/
├─ manifest.json          # 必需：包头
├─ pack_icon.png          # 可选：包标（列表里显示的图标）
├─ textures/
│  └─ ui/                 # 界面贴图，按下面的逻辑文件名覆盖
│     ├─ btn_stone.png
│     └─ ...
├─ font/
│  └─ main.ttf            # 可选：界面字体（也接受 main.otf）
├─ texts/
│  ├─ zh_CN.lang          # 可选：覆盖文案，key=value 格式
│  └─ en_US.lang
└─ ui/
   └─ theme.json          # 可选：主题变量覆盖
```

## manifest.json

```json
{
  "format_version": 2,
  "header": {
    "name": "我的资源包",
    "description": "说明文字",
    "uuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "version": [1, 0, 0],
    "min_engine_version": [1, 16, 0]
  },
  "modules": [
    { "type": "resources", "uuid": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy", "version": [1, 0, 0] }
  ]
}
```

导入时会校验：

- 压缩包内必须有根目录 `manifest.json`；
- `header.name`、`header.uuid`、`header.version` 缺一不可，否则拒绝导入；
- 同一 `uuid` 再次导入视为更新，会覆盖旧版本的包。

## 覆盖与优先级

- 所有已启用的包按列表顺序覆盖，**列表越靠上优先级越高**；
- 内置的「Vanilla 默认资源包」永远在最底部，优先级最低；
- 同一个路径在多个包里出现时，只有优先级最高的那一份生效；
- 在「设置 → 全局资源」里可以启用 / 停用、上移 / 下移、删除，操作后界面立即换材质，无需刷新扩展；
- 包体保存在 IndexedDB，关闭浏览器后仍然保留。

## 可覆盖的贴图文件名（放在 `textures/ui/` 下）

主菜单按钮、面板、槽位、页签、下拉、复选框、滚动条、图标默认图等全部从这里解析：

```
btn_light.png           btn_green.png           btn_green_hover.png
btn_stone.png           btn_stone_hover.png     btn_dialog_red.png
btn_dialog_light.png    indent.png             indent_hover.png
panel_dim.png           panel_gray.png         tab_back.png
tab_front.png           tab_front_green.png    scroll_handle.png
scroll_arrow_up.png     scroll_arrow_down.png  row_hover.png
dropdown_chevron.png    divider_light.png     toggle_off.png
toggle_off_hover.png    toggle_on.png          toggle_on_hover.png
missing_texture.png     title.png              plus_white.png
icon_plus_dark.png      icon_trash.png         icon_confirm.png
close_x_light.png       magnify.png            icon_preview.png
icon_setting.png        icon_inventory.png     icon_language.png
icon_undo.png           icon_packs.png         checkbox_on.png
checkbox_off.png        radio_on.png           radio_off.png
arrow_left.png
```

贴图建议保持原尺寸或整数倍尺寸，界面按整数倍像素放大，不使用平滑缩放。

## 字体

把字体文件放到 `font/main.ttf`（或 `font/main.otf`）。已启用时整页字体会切换为该字体；加载失败会自动回退到内置字体，不会出现方块字。

## 文案

`texts/` 下放与扩展内置同名的 `.lang`（`zh_CN.lang`、`zh_TW.lang`、`en_US.lang`、`ja_JP.lang`、`ko_KR.lang`、`es_ES.lang`、`ru_RU.lang`、`fr_FR.lang`），逐行 `key=value`。只需写想改的键，未写的键继续使用内置文案。

## 主题变量（ui/theme.json）

```json
{
  "--mc-green": "#4caf50",
  "--mc-light": "#c6c6c6"
}
```

键必须以 `--` 开头，值为 CSS 变量可接受的字符串；其它 `ui/` 文件会被完整保存，便于以后扩展布局定义。

## 示例包

- 源码目录：`packs/sample/`
- 可直接导入的包：`packs/sample.kzpack`

示例包把 `btn_stone.png` 换成了悬停态贴图，并把中英文的「设置」按钮文案改成带「示例资源包」的字样，导入后能直接在设置页和新标签页看到变化。

## 导入步骤

1. 打开 `settings.html`，左侧「全局资源」；
2. 点「添加资源包」，选择 `.kzpack` 或 `.zip`；
3. 导入成功后默认启用，排在已导入包列表的末尾、内置包之上；
4. 需要调整覆盖顺序时用 ↑ / ↓，或者停用某个包。
