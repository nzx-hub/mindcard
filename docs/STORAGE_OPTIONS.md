# 存储优化方案

> 现状：卡组与进度都在 `localStorage`，已按卡组拆键；单 origin 约 5 MB，同步写入，可能被浏览器清理。  
> 目标：在不改变现有 UI 的前提下，提高容量、降低卡顿、减少丢数据风险。

---

## 1. 先看瓶颈

| 数据 | 典型大小 | 说明 |
| --- | --- | --- |
| 一个 156 张卡的卡组 JSON | 约 60–80 KB | 中文在 localStorage 里按 UTF-16 存，实际占用更高 |
| 一个卡组的进度 | 10–300 KB | 取决于 `log`，当前上限 6000 条 |
| 进度备份 `:bak` | 与进度同量级 | 目前最多每分钟一份 |
| 卡组回收站 | 与被删卡组同量级 | 不清理会一直占空间 |
| 内置示例卡组 | 约 4 KB | 打包在 `decks.js`，不占 localStorage |

所以：

- 几十个课程卡组就可能逼近 5 MB；
- 每次评分同步 `JSON.stringify` 整个进度，日志多时会卡顿；
- 浏览器清理、隐私模式、配额满时，localStorage 没有可靠的事务和容量提示。

---

## 2. 方案总览

| 方案 | 容量 | 异步 | 用户可见文件 | 浏览器支持 | 迁移成本 | 适合 |
| --- | --- | --- | --- | --- | --- | --- |
| **A. 数据瘦身**（不换存储） | 仍 5 MB，但更耐用 | 否 | 否 | 全部 | 低 | 立刻做 |
| **B. IndexedDB** | 大（按磁盘配额） | 是 | 否 | 全部现代浏览器 | 中 | **首选** |
| **C. OPFS** | 大 | 是（Worker 内可同步） | 否 | Chrome/Edge、Safari、Firefox 新版本 | 中高 | 大文件/附件 |
| **D. File System Access** | 磁盘 | 是 | ✅ | 仅 Chromium 桌面 | 中 | 用户想“文件在磁盘” |
| **E. SQLite WASM** | 大 | 是 | 否 | 支持 WASM+OPFS 的现代浏览器 | 高 | 数万卡片、全文搜索 |
| **F. 桌面 App（Tauri/Electron）** | 磁盘 | 是 | ✅ | Windows/macOS/Linux | 高 | 真正本地文件 |
| **G. 云端同步** | 服务端 | 是 | 否 | 全部 | 高 | 多设备，非本地优先 |
| **H. 混合** | 大 | 是 | 可选 | 视组合 | 中 | 长期方向 |

---

## 3. 方案 A：数据瘦身（零迁移）

不换存储，先把“该省的”省掉。

### 3.1 进度压缩

- 只存有状态的卡片（现在已经是这样）；
- 去掉冗余字段：`lastG`、`reps` 若只用于统计，可合并或改成短字段；
- 用数组/短键存状态，例如 `[step, ease, due, reps, lapses]`，比对象省 30–50%；
- `due` 用“天序号”而不是毫秒时间戳，省字符但可读性下降。

### 3.2 日志聚合

- 原始 `log` 只保留最近 30–90 天；
- 更早的记录聚合成每日统计 `{date, reviewed, correct, newCount}`；
- 热力图、正确率、连续天数都从聚合数据算，不再依赖全量日志。

当前 6000 条日志约 200–300 KB；聚合后通常 < 20 KB。

### 3.3 回收站与备份

- 回收站超过 30 天自动清理，或限制总大小；
- 每个卡组只保留 1 份 `:bak`，按天轮换，不要每分钟一份；
- 删除卡组时提供“立即导出”而不是默默占空间。

### 3.4 懒加载

- 内存里只保留当前卡组；
- 卡组列表只读元数据（id、标题、卡片数），进入学习时再读完整卡组；
- 需要索引：`mindcard:deck-index` 存 `{id,title,cards,updatedAt,size}`。

### 3.5 压缩

- `CompressionStream('gzip')` 可把 JSON 压到 20–40%；
- 但 localStorage 只能存字符串，gzip 后转 Base64 会增加 33%；
- 所以压缩只在“压缩率 > 25%”时划算，更适合 IndexedDB 存 Blob/ArrayBuffer。

**评价**：成本最低，能撑更久；但解决不了 5 MB 硬上限和同步卡顿。

---

## 4. 方案 B：IndexedDB（推荐）

### 为什么

- 容量按磁盘配额，通常远大于 5 MB；
- 异步、事务，不会阻塞评分；
- 可存对象、Blob、ArrayBuffer，不必先转字符串；
- 支持索引，可按 `deckId`、`updatedAt` 查询。

### 建议结构

```
DB: mindcard
  store decks      keyPath: id
  store progress   keyPath: deckId
  store backups    keyPath: [deckId, timestamp]
  store meta       keyPath: key
```

### 适配层

保留现在的 `MindCardDecks` API，只把底层换成 IndexedDB：

```js
interface StorageAdapter {
  listDecks(): Promise<DeckMeta[]>;
  getDeck(id): Promise<Deck>;
  putDeck(deck): Promise<void>;
  deleteDeck(id): Promise<void>;
  getProgress(deckId): Promise<Progress>;
  putProgress(deckId, progress): Promise<void>;
}
```

- UI 仍然读内存中的 `S`/`CARDS`，保持同步；
- 启动时 `await loadAll()`，显示 splash；
- 写入走防抖队列 + 事务，失败回退到 localStorage 并提示；
- 多标签用 `BroadcastChannel` 通知刷新，IndexedDB 本身不会触发 `storage` 事件。

### 迁移

1. 首次启动检测 `mindcard:deck:*`；
2. 逐个写入 IndexedDB；
3. 校验数量/大小；
4. 成功后保留旧键 7 天再删除，失败则继续用 localStorage；
5. 进度同样迁移。

### 成本

约 3–6 天（含迁移、回退、测试）。

**评价**：容量、性能、兼容性最平衡，是当前最值得做的一步。

---

## 5. 方案 C：OPFS（Origin Private File System）

- 每个 origin 一个私有文件系统，可读写文件；
- 容量大，适合大卡组、图片、附件；
- Worker 里可用同步 API，主线程仍异步；
- 文件对用户不可见，不能直接拿资源管理器打开。

适合：卡组里开始放图片/音频，或者单卡组超过几 MB。

不适合：只想替代 localStorage 存 JSON 的场景，收益不如 IndexedDB 直接。

---

## 6. 方案 D：File System Access API

- 用户选择磁盘上的文件/文件夹，应用直接读写；
- 数据是用户可见的 `.json`，可以备份、同步、进 Git；
- 仅 Chromium 桌面支持；权限可能需要重新授权；
- 文件句柄可存 IndexedDB，下次恢复。

适合：想“数据就在我的文件夹里”，又不想装桌面 App。  
不适合：Safari/Firefox 用户，或需要无感自动保存的场景。

---

## 7. 方案 E：SQLite WASM

- 浏览器里跑 SQLite，数据放 OPFS；
- 事务、索引、全文搜索、复杂查询都成熟；
- 体积增加约 1 MB WASM；
- 学习/调试成本高，需要 Worker。

适合：几万张卡片、需要按标签/全文搜索、统计复杂。  
当前规模（几百到几千张）用不上。

---

## 8. 方案 F：桌面 App

Tauri/Electron 直接读写磁盘 JSON，详见 [`DESKTOP_APP.md`](DESKTOP_APP.md)。

- 优点：真正的本地文件、容量无限、可备份；
- 缺点：安装包、签名、更新、跨平台测试。

---

## 9. 方案 G：云端同步

Supabase / Firebase / 自建 API：

- 多设备同步、账号、分享；
- 需要登录、冲突合并、隐私政策；
- 与“本地优先、零后端”的定位冲突。

建议：先把本地存储做好，云端作为可选插件，不要一开始就上。

---

## 10. 推荐路线

### 阶段 1：立刻做（1–2 天）

- 日志聚合 + 上限；
- 回收站 30 天清理；
- `:bak` 按天轮换；
- 设置页显示 `navigator.storage.estimate()` 用量；
- 配额满时提示“导出并清理”。

### 阶段 2：核心（3–6 天）

- IndexedDB 适配层；
- 启动加载 + 写入队列；
- localStorage → IndexedDB 迁移与回退；
- `BroadcastChannel` 多标签通知。

### 阶段 3：按需（1–2 周）

- 卡组内附件/图片 → OPFS；
- 用户可见文件 → File System Access；
- 或直接做 Tauri 桌面版。

### 阶段 4：规模化（可选）

- SQLite WASM + 全文搜索；
- 云端同步。

---

## 11. 不建议现在做的

- 为了省空间把题目/答案压成二进制：可读性、可分享性都没了；
- 把卡组塞进 IndexedDB 却仍每次全量读写：只是换了个大桶，卡顿还在；
- 直接上 SQLite：当前数据量不值得；
- 先做云同步：会把本地存储问题拖得更久。

---

## 12. 一句话建议

**先用“日志聚合 + 回收站清理 + 备份轮换”撑住，再把存储层换成 IndexedDB。**  
这两步完成后，5 MB 限制和评分卡顿基本就消失了；磁盘文件/桌面 App 再作为下一步。
