# 把 MindCard 做成桌面 App（本地磁盘存储）可行性分析

> 结论：**可以**。浏览器界面可以原样复用；需要新增一个桌面外壳（Electron / Tauri 等），并把 `localStorage` 换成“内存 + 磁盘文件”的存储适配层。
>
> **“不改界面” ≠ “不改代码”**：视图和样式可以不动，但存储调用必须从同步的 `localStorage` 改成可异步落盘的适配层，否则无法可靠写磁盘。

---

## 1. 需求拆解

| 需求 | 判断 |
| --- | --- |
| 保留现有浏览器界面 | ✅ 可以，视图层不用重写 |
| 卡组、进度存电脑本地磁盘 | ✅ 可以，建议一个卡组一个 JSON、进度一个 JSON |
| 不依赖浏览器 localStorage | ✅ 桌面壳提供文件系统权限 |
| 离线可用 | ✅ 桌面 App 天生离线 |
| 和网页版共用一套代码 | ✅ 用 StorageAdapter 抽象即可 |

---

## 2. 三条可行路线

### 路线 A：PWA + File System Access API

不打包，仍然是网页，但让用户选择磁盘上的文件/文件夹。

- 优点：零安装、复用现有网页、改动最小；
- 缺点：
  - 只有 Chromium 系（Chrome / Edge）支持；
  - 文件/目录访问需要用户授权，重启后可能再次询问；
  - 不是真正的“应用”，没有开始菜单、单实例、自动更新；
- 适合：先验证“磁盘存储”需求，不追求安装包。

### 路线 B：Tauri（推荐）

Rust 后端 + 系统 WebView（Windows 用 WebView2）。

- 体积约 5～15 MB；
- 原生文件读写、对话框、单实例、自动更新；
- 前端仍是现有 HTML/CSS/JS，几乎不改 UI；
- 代价：需要 Rust 工具链；Windows 10+ 需 WebView2 运行时（多数已自带）；
- 适合：想正式发布、在意体积和性能。

### 路线 C：Electron（最快落地）

Chromium + Node.js，前端代码直接跑。

- 优点：生态成熟、Node `fs` 直接读写、调试简单、跨平台一致；
- 缺点：安装包 100 MB 起步、内存占用高、启动慢；
- 适合：先快速做出可用版本，后续再考虑 Tauri。

### 其他

| 方案 | 评价 |
| --- | --- |
| NW.js | 类似 Electron，社区较小 |
| Neutralinojs | 轻量，但生态和文件 API 不如 Tauri |
| Wails（Go） | 类似 Tauri，Go 工具链 |
| 本地起 HTTP 服务 + 浏览器 | 数据能落盘，但不是 App；端口/防火墙/启动脚本都是负担 |

---

## 3. 关键改造：存储适配层

当前代码直接调用 `localStorage.getItem/setItem`，是**同步**的；磁盘读写是**异步**的。  
不要在每个视图里改成 `await`，而是把存储收口到一个适配器：

```
UI / 视图（不改）
   ↓
Store（内存中的 decks / progress / settings）
   ↓
StorageAdapter
   ├─ BrowserLocalStorageAdapter   （网页版）
   └─ DesktopFileAdapter           （App 版）
```

### 3.1 启动流程

1. App 启动，显示一个轻量 splash；
2. `DesktopFileAdapter.loadAll()` 读取磁盘上的卡组、进度、设置；
3. 全部装入内存 Store；
4. 启动现有 UI（UI 读内存，保持同步）；
5. 任何修改先改内存，再异步落盘（debounce 300～500 ms）。

这样 UI 仍然可以同步读数据，不需要把每个函数改成 async。

### 3.2 接口草案

```js
interface StorageAdapter {
  loadAll(): Promise<{ decks, progressByDeck, settings }>;
  saveDeck(deck): Promise<void>;
  deleteDeck(deckId): Promise<void>;
  saveProgress(deckId, progress): Promise<void>;
  saveSettings(settings): Promise<void>;
  exportBackup(): Promise<string>;   // 返回备份目录
}
```

### 3.3 写入策略

- **原子写**：写 `xxx.json.tmp` → `fsync` → `rename` 覆盖，避免半截文件；
- **备份**：覆盖前保留 `xxx.json.bak`，或每天一份 `backups/`；
- **防抖**：评分时不要每点一次就写盘，合并 300～500 ms 写一次；
- **版本号**：每个文件带 `schemaVersion`，启动时迁移；
- **单实例**：只允许一个 App 实例写同一目录，避免并发覆盖；
- **文件监听（可选）**：外部修改卡组后提示重载。

---

## 4. 磁盘目录设计

推荐“用户可见、可备份、可 Git”的结构：

```
MindCard/
├─ config.json                 # 主题、语言、最近打开的卡组
├─ decks/
│  ├─ example-study-notes.json
│  └─ my-deck.json
├─ progress/
│  ├─ example-study-notes.json
│  └─ my-deck.json
├─ backups/
│  └─ 2026-11-22/
└─ imports/                    # 用户拖进来的原始文件（可选）
```

- **卡组与进度分离**：卡组可以单独分享、提交 Git；进度是私人的；
- **一个卡组一个文件**：便于手动编辑、冲突排查、增量备份；
- **默认位置**：
  - Windows：`%APPDATA%\MindCard\`
  - macOS：`~/Library/Application Support/MindCard/`
  - Linux：`~/.config/mindcard/`
- 提供“打开数据目录”“导出备份”按钮，避免用户找不到文件；
- 也支持“便携模式”：数据放在 exe 同级的 `data/`，适合 U 盘。

### 文件名安全

- 卡组 `id` 已经限制为小写字母/数字/短横线，可直接作为文件名；
- 导入时仍要校验，禁止 `../`、绝对路径、Windows 保留名（CON、NUL 等）；
- 写文件前 `path.resolve` 后确认仍在数据目录内。

---

## 5. 主要困难与解决方案

| # | 困难 | 具体表现 | 解决方案 |
| --- | --- | --- | --- |
| 1 | **同步 API 与异步磁盘不匹配** | 现有代码同步读 `localStorage`，文件 API 是 Promise | 启动时一次性读入内存；UI 读内存；写盘异步防抖 |
| 2 | **崩溃/断电导致文件损坏** | 写到一半退出，JSON 损坏 | 临时文件 + 原子 rename；保留 `.bak`；启动时校验并回滚 |
| 3 | **多实例/多窗口并发写** | 两个窗口各写一份，后写覆盖 | 单实例锁；或文件锁 + mtime 检测；冲突时提示 |
| 4 | **数据迁移** | 浏览器 localStorage 与 App 文件系统不同源 | 网页版导出 JSON → App 导入；首次启动提供迁移向导 |
| 5 | **格式升级** | 旧卡组缺字段、进度结构变化 | `schemaVersion` + 迁移函数；迁移前自动备份 |
| 6 | **打包与签名** | Windows SmartScreen、macOS Gatekeeper | 代码签名证书；macOS 公证；提供免安装 zip |
| 7 | **自动更新** | 用户停留在旧版，数据格式不兼容 | 更新前检查数据版本；保留旧版回滚；更新器只替换程序不碰数据 |
| 8 | **WebView 差异** | Tauri 的 WebView2 与 Chrome 行为略有差异 | 目标 ES2020；避免实验性 API；在 Windows/macOS 实机测试 |
| 9 | **文件系统权限/安全** | 恶意卡组写任意路径、XSS | 卡组只读 JSON；路径白名单；不执行卡组里的 HTML/脚本；沙箱 |
| 10 | **大规模数据性能** | 上千张卡、频繁评分，整文件重写 | 一个卡组一个文件；进度按卡组拆分；防抖；必要时 SQLite |
| 11 | **多设备同步** | 磁盘本地，换电脑不同步 | 不承诺同步；用 OneDrive/坚果云同步 `data/`，但要处理冲突副本 |
| 12 | **测试矩阵** | Windows/macOS/Linux、Unicode 路径、长路径、杀毒软件 | CI 构建；路径/编码用例；便携版测试；签名减少误报 |
| 13 | **UI 之外的桌面体验** | 菜单、快捷键、拖拽导入、文件对话框 | 加原生菜单和拖拽；不改现有页面布局 |
| 14 | **安装包体积/内存** | Electron 100 MB+、内存高 | 选 Tauri；或 Electron 仅内测 |
| 15 | **许可与版权** | 打包了课程卡组再分发 | 公开安装包只带示例卡组；课程卡组留在用户数据目录 |

---

## 6. 推荐实施方案（分阶段）

### 阶段 0：先做存储抽象（网页版也能受益）

- 新增 `storage/` 层，把 `localStorage` 调用收口；
- 保持现有 UI 不变；
- 网页版继续用 localStorage，App 版换文件适配器；
- 这一步不改变用户可见行为，但为后续铺路。

### 阶段 1：Electron 内测版

- 用 Electron 包一层，主进程提供 `loadAll/saveDeck/saveProgress`；
- 数据目录 `app.getPath('userData')`；
- 实现导入/导出、打开数据目录；
- 验证崩溃恢复、单实例、文件权限。

### 阶段 2：Tauri 正式版（可选）

- 同样的前端 + 文件适配器，换成 Tauri 命令；
- 体积从 100 MB 降到 ~10 MB；
- 加代码签名、自动更新、安装包。

### 阶段 3：体验完善

- 拖拽 `.json/.md` 到窗口直接导入；
- 原生菜单：文件 / 编辑 / 视图 / 帮助；
- 自动备份与“恢复上一版本”；
- 可选：本地全文搜索（SQLite FTS）。

---

## 7. 是否值得做 App？

**适合做 App 的理由**

- 数据完全在本地磁盘，用户可见、可备份；
- 不依赖浏览器清理策略，localStorage 5 MB 上限消失；
- 可离线、可开机启动、可拖拽文件；
- 卡组文件可以直接用 Git 管理。

**可以先不做的理由**

- 网页版 + 导出/导入已经能满足“本地保存”；
- App 带来签名、更新、跨平台测试的长期维护成本；
- 如果只是自己用，PWA + 定期导出 JSON 成本最低。

**建议**：先做存储抽象（阶段 0），再决定是否投入 Electron/Tauri。这样无论做不做 App，网页版的存储都会更干净。

---

## 8. 一句话总结

界面可以不动；把 `localStorage` 换成“内存 Store + 磁盘文件适配器”，再用 Tauri/Electron 套壳，就能得到一个数据存在本地磁盘的 MindCard。  
最大的工作量不在 UI，而在**异步存储、原子写入、迁移、打包签名**这四件事上。
