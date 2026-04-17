# 应用图标

## 源图

- `src-tauri/icons/source.svg` — 原始设计稿，512×512 无 padding。只保留作为"干净"版本，不直接喂给打包工具。
- `src-tauri/icons/source-macos.svg` — **打包实际使用的源图**。1024×1024 画布，将 `source.svg` 居中缩放到 ~824×824，四周留约 100px 透明 padding。

两份都提交到仓库。改图标时同时更新这两份，保证设计稿和带 padding 版本一致。

## 为什么需要 padding

Apple HIG 要求 macOS app 图标在 1024 画布中把主体收到 ~824×824，四周透明，让 Dock / Launchpad 里的图标和系统其他应用视觉大小一致。满画布图在 `tauri build` 产物里看着偏大一圈，在 `tauri dev`（直接跑裸二进制、通过 NSApplication 设 Dock 图标）下尤其明显——NSImage 从单张 PNG 拿不到 scale factor 提示，Dock 基本按原始像素展示。

所以跨平台图标统一以带 padding 的 `source-macos.svg` 为源。Windows / Linux 下主体略小一圈，属于可接受的折中，比给每个平台单独维护一套图标的成本低。

## 重建整套图标

```bash
npx tauri icon src-tauri/icons/source-macos.svg
```

这个命令会覆盖 `src-tauri/icons/` 下全部 PNG / ICO / ICNS / iOS / Android 资源。如果只想看预览而不覆盖，先用 `rsvg-convert` 导出单张 PNG 检查。

## 关键取舍

- **只维护一份带 padding 的源图，不分平台**：`tauri icon` 不支持按平台指定不同源图，硬要分平台得手工拼 `.icns` / `.ico`，维护成本高。当前方案牺牲 Windows / Linux 下主体大小，换取流程简单。
- **不在 `tauri::Builder::setup` 里对 Dock 图标做特殊处理**：dev 模式 Dock 偏大的根因是 NSImage 拿不到 scale factor，运行时代码绕不过去——与其写一段 `#[cfg(debug_assertions)]` 换图，不如把源图本身做对，dev / build 都自然正常。
- **不迁移到 1024×1024 无 padding 的新设计**：会让 build 产物在 Dock 里继续偏大。padding 是规范，不是设计上的妥协。
