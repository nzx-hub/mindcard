# 卡组格式规范（Deck Format v1）

一个卡组就是一个 UTF-8 编码的 JSON 文件，后缀 `.json`。  
它只描述**内容**，不包含学习进度；进度按卡组 id 单独保存。

JSON Schema：[`schemas/deck.schema.json`](../schemas/deck.schema.json)  
校验命令：`python tools/validate_deck.py decks/your-deck.json`

---

## 1. 顶层结构

```json
{
  "schemaVersion": 1,
  "id": "example-study-notes",
  "title": "间隔重复学习法",
  "subtitle": "示例卡组",
  "description": "用规则从 Markdown 转换而来的示例。",
  "language": "zh-CN",
  "author": "your-name",
  "license": "CC-BY-4.0",
  "tags": ["学习方法", "间隔重复"],
  "source": { "type": "md", "name": "sample-notes.md" },
  "chapters": [ ... ],
  "cards": [ ... ],
  "extras": { ... }
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `schemaVersion` | 是 | 固定 `1`；未来不兼容变更时递增 |
| `id` | 是 | 全局唯一，小写字母/数字/短横线，2–64 位；**发布后不要改** |
| `title` | 是 | 卡组标题 |
| `subtitle` | 否 | 副标题 |
| `description` | 否 | 简介 |
| `language` | 否 | BCP-47，如 `zh-CN`、`en` |
| `mode` | 否 | `short`（网页内可编辑，默认）/ `long`（只读，需导出修改或另存为短期） |
| `author` | 否 | 作者/整理者 |
| `license` | 否 | 建议填写，如 `CC-BY-4.0`、`CC0-1.0` |
| `tags` | 否 | 最多 20 个 |
| `source` | 否 | 来源：`type` 为 `manual/md/txt/docx/pptx/pdf/xlsx/url` |
| `legacyProgressKey` | 否 | 旧版应用的进度键，导入后首次加载时用于迁移旧进度 |
| `targetCards` | 否 | 计划卡片数，仅用于编辑器显示「已添加 / 计划」 |
| `chapters` | 是 | 至少 1 个 |
| `cards` | 是 | 至少 1 张 |
| `extras` | 否 | 卡组自带扩展，如速查表；UI 决定是否展示 |

> `id` 是进度存储键的一部分。改 id 等于换了一个卡组，旧进度不会自动跟随。  
> 浏览器导入时会把 `mode` 统一设为 `short`，方便继续编辑；导入后可在「卡组」页手动「转为长期」。

> `question`/`answer` 与对应的 `questionImage`/`answerImage` 至少有一个非空。图片以 Data URL 内嵌，便于单文件分享，但会明显增大卡组体积。

---

## 2. 章节（chapters）

```json
{
  "id": "ch-01",
  "order": 1,
  "name": "第 1 章 基本原理",
  "short": "基本原理",
  "color": "#0f766e"
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | `ch-` 开头，小写字母/数字/短横线 |
| `order` | 否 | 排序，缺省按数组顺序 |
| `name` | 是 | 完整名称 |
| `short` | 否 | 角标/图上用的短名，建议 ≤ 8 字 |
| `color` | 否 | `#RRGGBB`，用于图表配色 |

---

## 3. 卡片（cards）

### 3.1 公共字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 卡组内唯一；建议 `c-0001`，**不要修改已发布卡片的 id** |
| `chapter` | 是 | 必须引用存在的章节 id |
| `type` | 是 | `recall` / `cloze` / `choice` / `judge` / `code` |
| `question` | 是* | 题干，纯文本 + 极简 Markdown；有 `questionImage` 时可为空 |
| `answer` | 是* | 答案与解析；有 `answerImage` 时可为空 |
| `questionImage` | 否 | 题目图片，`data:image/(png\|jpeg\|webp\|gif);base64,...` |
| `answerImage` | 否 | 答案图片，格式同上；导出 JSON 会内嵌图片 |
| `tag` | 否 | 角标，如“概念”“公式”“易错” |
| `hint` | 否 | 提示，先于答案展示（可选） |
| `explanation` | 否 | 补充解析 |
| `source` | 否 | `{page, url, quote}`，便于回溯 |
| `pre` | 否 | 题干下方单独显示的代码块 |
| `accept` | 否 | 填空的可接受答案（cloze 必填） |
| `options` / `answerIndex` | 选择题必填 | 选项数组 + 正确项下标（从 0 开始） |
| `correct` | 判断题必填 | `true` 表示“正确”，`false` 表示“错误” |

### 3.2 简答 / 自评卡 `recall`

```json
{
  "id": "c-0001",
  "chapter": "ch-01",
  "type": "recall",
  "tag": "概念",
  "question": "什么是间隔重复？",
  "answer": "在即将遗忘之前安排下一次复习，用逐渐拉长的间隔对抗遗忘曲线。"
}
```

答案支持：

- `**加粗**`
- 换行 `\n`
- ```` ``` ```` 包裹的代码块
- 行内 `` `代码` ``

### 3.3 填空卡 `cloze`

```json
{
  "id": "c-0002",
  "chapter": "ch-01",
  "type": "cloze",
  "question": "间隔重复的英文缩写是 ____。",
  "answer": "**SRS**（Spaced Repetition System）",
  "accept": ["SRS", "srs", "间隔重复系统"]
}
```

规则：

- 题干中用 `____` 标空；
- `accept` 至少一项，比较时忽略大小写、空格和常见标点；
- 多空可用空格分隔输入（具体判定由引擎实现）。

### 3.4 选择题 `choice`

```json
{
  "id": "c-0003",
  "chapter": "ch-01",
  "type": "choice",
  "question": "下列哪一项最符合“主动回忆”？",
  "options": [
    "反复阅读笔记",
    "合上答案先自己回想",
    "把同一类题连做 50 道",
    "只看目录"
  ],
  "answerIndex": 1,
  "answer": "**B**。主动回忆强调在不看答案的情况下提取信息。"
}
```

- `options` 2–8 项；
- `answerIndex` 从 0 开始；
- `answer` 里建议重复正确项字母，方便复习。

### 3.5 判断题 `judge`

```json
{
  "id": "c-0004",
  "chapter": "ch-01",
  "type": "judge",
  "question": "间隔重复的复习间隔应该越来越短。",
  "correct": false,
  "answer": "**错误**。间隔应逐渐拉长，而不是缩短。"
}
```

### 3.6 代码 / 计算题 `code`

```json
{
  "id": "c-0005",
  "chapter": "ch-02",
  "type": "code",
  "question": "用 Python 写一个斐波那契函数。",
  "pre": "def fib(n):\n    # 请补全",
  "answer": "```python\ndef fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\n```"
}
```

`pre` 展示题干代码；`answer` 中用代码围栏写参考代码。

---

## 4. 用 Markdown 写卡组（给 `tools/convert.py` 用）

转换器只识别“结构化”内容，不会把普通段落硬变成题。推荐写法：

```markdown
# 卡组标题

## 第 1 章 基本原理

Q: 什么是间隔重复？
A: 在即将遗忘之前安排下一次复习。

- 主动回忆：先合上答案自己回想，再翻看核对。
- 合意困难：让学习当时更费力、但长期记忆更好的安排。

| 术语 | 定义 |
| --- | --- |
| SRS | 间隔重复系统 |
| 提取练习 | 不看答案主动回忆 |
```

规则：

| 写法 | 生成 |
| --- | --- |
| `# 标题` | 卡组标题（仅第一个一级标题） |
| `## 章节名` 或 `第 X 章 …` | 章节 |
| `Q: …` + `A: …` | 简答卡 |
| `问：…` + `答：…` | 简答卡 |
| 两列表格 | 每行一张简答卡 |
| `- 术语：定义` | 简答卡 |
| 其他段落 | 默认忽略（`--mode outline` 时也尝试提取“术语：定义”） |

命令：

```bash
python tools/convert.py notes.md -o decks/my-deck.json --id my-deck --title "我的卡组"
python tools/validate_deck.py decks/my-deck.json
```

---

## 5. 扩展字段 `extras`

用于放卡组专属的展示内容，例如速查表：

```json
"extras": {
  "cheatsheet": [
    {
      "title": "定时器寄存器",
      "html": "<table>…</table>"
    }
  ]
}
```

> `extras` 内容由前端按白名单渲染；不要放脚本。没有 `extras` 时，UI 隐藏“速查”入口。
> v0.3 目前只内置示例课程的速查表，导入卡组的 `extras` 暂不渲染，等加入 HTML 白名单清洗后再开放。

---

## 6. 版本与迁移

- `schemaVersion: 1` 是当前版本。
- 新增**可选字段**不升版本；删除/改名字段才升版本。
- 引擎读取时按 `schemaVersion` 选择迁移函数，迁移后再校验。
- 卡组 id 与卡片 id 是进度关联键，迁移时不得重排。

---

## 7. 常见错误

| 错误 | 后果 | 修正 |
| --- | --- | --- |
| `card.chapter` 拼错 | 卡片不显示 | 用 `validate_deck.py` 检查 |
| 卡片 id 重复 | 进度串卡 | 保持全局唯一 |
| 改了已发布卡片 id | 旧进度丢失 | 新增卡片用新 id，旧卡保留 |
| 选择题 `answerIndex` 越界 | 无法判分 | 校验脚本会报错 |
| 填空题没有 `accept` | 无法自动判分 | 至少给一个可接受写法 |
| 答案里直接写 HTML | 被转义或显示异常 | 用 Markdown 子集 |

---

## 8. 最小可发布卡组

```json
{
  "schemaVersion": 1,
  "id": "minimal-deck",
  "title": "最小卡组",
  "chapters": [{ "id": "ch-01", "name": "默认章节" }],
  "cards": [{
    "id": "c-0001",
    "chapter": "ch-01",
    "type": "recall",
    "question": "这张卡的问题是什么？",
    "answer": "这就是答案。"
  }]
}
```
