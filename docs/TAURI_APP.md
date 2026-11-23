# Tauri 桌面版（第一版）

> 目标：用现有 `app/` 界面生成一个独立窗口的 Windows 桌面应用，先看效果。  
> 当前版本：`0.1.0`，原生标题栏，Windows NSIS 安装包。

---

## 1. 已生成的结构

```text
MindCard/
├─ app/                         # 现有前端，原样复用
├─ src-tauri/
│  ├─ Cargo.toml
│  ├─ build.rs
│  ├─ tauri.conf.json
│  ├─ capabilities/
│  │  └─ default.json
│  ├─ src/
│  │  └─ main.rs
│  └─ icons/
│     ├─ source.svg             # 从网页 logo 提取的源文件
│     ├─ icon.ico               # Windows
│     ├─ icon.icns              # macOS
│     ├─ icon.png
│     └─ 32x32.png / 128x128.png / ...
└─ tools/
   └─ build_single_file.py
```

`tauri.conf.json` 的关键配置：

- 窗口标题：`MindCard · 忆卡`
- 默认尺寸：1200 × 820
- 最小尺寸：920 × 620
- 原生标题栏：`decorations: true`
- 前端目录：`../app`
- 安装包：Windows NSIS
- 标识：`com.mindcard.desktop`

---

## 2. 图标溯源

网页端没有独立的 logo 图片文件，图标来自两处：

1. `app/index.html` 第 16–18 行的内联 SVG（线稿书本）；
2. `app/styles.css` 第 93–98 行 `.brand .mark` 的圆角渐变底色。

因此“网页端图标”不是一个可以直接复用的 `.png`，而是 **SVG + CSS 组合**。  
已把它还原为真正的矢量文件：

```text
src-tauri/icons/source.svg
```

然后由 Tauri CLI 生成各平台图标：

```powershell
npx @tauri-apps/cli@2 icon src-tauri/icons/source.svg -o src-tauri/icons
```

生成内容包括：

- Windows：`icon.ico`（多尺寸）
- macOS：`icon.icns`
- Linux/通用：`32x32.png`、`128x128.png`、`128x128@2x.png`、`icon.png`
- Windows Store：`Square*Logo.png`、`StoreLogo.png`
- 移动端：`android/`、`ios/`（当前桌面版不用）

---

## 3. 构建环境

本机当前使用：

- Rust `stable-x86_64-pc-windows-gnu`
- MinGW `C:\mingw64`
- WebView2 Runtime 已安装
- Node.js / npx
- Tauri CLI 2.x

Tauri 官方更推荐 MSVC 工具链；本机没有 Visual Studio Build Tools，所以先用 GNU 工具链验证。  
正式发布建议装 **Visual Studio Build Tools（C++ 工作负载）**，用默认 MSVC 构建。

---

## 4. 构建命令

在 `MindCard/` 下：

```powershell
.\tools\build_desktop.ps1            # 只编译 exe
.\tools\build_desktop.ps1 -Bundle    # 生成 NSIS 安装包
```

脚本内部会：

1. 把 `app/` 和 `src-tauri/` 复制到 `%TEMP%\mindcard-stage-<pid>`（纯 ASCII 路径，避免旧目录 ACL 问题）；
2. 设置 Rust GNU / MinGW / `link-self-contained`；
3. 把 `CARGO_TARGET_DIR` 设为 `%USERPROFILE%\mindcard-target`；
4. 构建后把产物复制到 `dist/MindCard.exe` / `dist/MindCard-setup.exe`。

> 本机 MinGW 8.1 的 `libgcc_s_seh-1.dll` 与 Rust 1.100 不兼容，必须用 `link-self-contained=yes`；中文源码路径会让 `windres`/`ld` 失败，所以必须走 ASCII 暂存目录。

产物位置：

```text
%USERPROFILE%\mindcard-target\release\mindcard.exe
%USERPROFILE%\mindcard-target\release\bundle\nsis\*.exe
```

脚本会另外复制一份到：

```text
dist/MindCard.exe
dist/MindCard-0.1.0-portable.zip   # 解压即用，含 exe + WebView2Loader.dll + README
dist/MindCard-setup.exe             # -Bundle 且 NSIS 下载成功时
```

当前环境访问 GitHub 下载 NSIS 超时，只生成 exe 和便携包；网络恢复后可补安装包。
便携包解压后必须保持 `MindCard.exe` 与 `WebView2Loader.dll` 在同一目录。

---

## 5. 存储与当前限制

桌面版已做磁盘存储适配，不再只依赖 WebView 的 `localStorage`：

- 启动时通过 Rust 命令 `storage_load` 把磁盘快照载入 `localStorage`，再启动前端；
- 所有 `mindcard:*` 写入由 `app/storage.js` 镜像到磁盘；
- 数据目录为应用数据目录下的 `storage/`，Windows 默认：
  `%LOCALAPPDATA%\com.mindcard.desktop\storage\`
- 每个键对应一个 hex 文件名的 `.json`，例如 `mindcard:deck:my-deck`；
- 首次运行且磁盘为空时，自动把旧 WebView `localStorage` 数据迁移到磁盘；
- 磁盘已有数据时以磁盘为准，启动时会清理 `localStorage` 里过期的 `mindcard:*` 缓存；
- 设置 `MINDCARD_DATA_DIR` 可以覆盖整个应用数据目录（便携/测试用）。

存储格式是**明文 JSON**，不是加密数据库；需要保护隐私时，使用系统磁盘加密或后续的可选加密层。

当前限制：

- 没有自定义标题栏；
- 没有代码签名，Windows 可能弹 SmartScreen；
- CSP 暂设为 `null`，因为现有页面有内联脚本/样式；
- 没有自动更新；
- 多开实例同时写同一卡组时，仍可能出现最后写入覆盖；后续可加单实例锁。

下一步建议：

1. 增加单实例、文件关联 `.mindcard`；
2. 可选自定义标题栏（需要设计稿）；
3. 代码签名 + 自动更新；
4. 可选加密存储/导出。

---

## 6. 为什么不是“完全不用浏览器”

Tauri 使用系统 WebView2 渲染现有 HTML/CSS/JS。  
用户看到的是独立窗口，不需要打开 Chrome，但底层仍然是 WebView。  
如果要求“完全不用任何浏览器引擎”，只能原生重写（WPF/Qt/Flutter），成本高得多。