# 发布到 GitHub 与安全检查

> 对象：`MindCard/` 当前版本。  
> 结论：可以公开分享；GitHub 用户无法通过源码读取你电脑上的文件或浏览器数据，但**提交内容、Git 作者信息、文档里的绝对路径、截图**可能泄露个人信息。

---

## 0. 当前状态

- 目录还没有 `.git`，是全新仓库，没有历史泄露；
- 课程卡组已移到仓库外的 `../MindCard-private/`，约 70 KB，不会进公开仓库；
- `app/`、`decks/` 只有示例卡组；
- 未发现 `ghp_`、`github_pat_`、`sk-`、`.env` 等密钥；
- `README.md`、`docs/ARCHITECTURE.md` 提到课程名/文件名，但不是卡组内容；
- `pages.yml` 只上传 `./app`，仓库外内容不会部署；
- `validate.yml` 会校验卡组并检查 `app/decks.js` 是否最新。

---

## 1. GitHub 用户能追溯到哪里？

### 不能

仅凭源码和 Pages 站点，不能：

- 读取你电脑上的文件；
- 读取你的浏览器 localStorage；
- 读取你保存的密码、API Key；
- 访问你的仓库外私有目录；
- 通过网页调用你本机的接口。

浏览器有同源策略和沙箱，GitHub Pages 只是静态文件。

### 能

公开后，别人能看到：

| 内容 | 是否公开 |
| --- | --- |
| 仓库里的源码、文档、示例卡组 | ✅ |
| Git 提交作者姓名/邮箱 | ✅（取决于你的 Git 配置） |
| 提交时间、提交信息 | ✅ |
| 仓库所属 GitHub 账号和公开资料 | ✅ |
| Pages 站点 URL | ✅ |
| 你提交过的 `.env`、密钥、绝对路径 | ✅（如果曾经提交） |
| 你本机的私有目录、浏览器数据 | ❌（只要没提交） |

**核心：Git 只上传“提交过的内容”，不会上传整个工作目录。**

---

## 2. 真正会泄露个人信息的几个点

### 2.1 Git 作者信息

第一次提交会使用：

```text
user.name
user.email
```

如果用的是真实姓名/常用邮箱，提交记录里会公开。

建议用 GitHub 的 noreply 邮箱：

```powershell
git config user.name "你的昵称"
git config user.email "12345678+username@users.noreply.github.com"
```

noreply 地址在 GitHub → Settings → Emails 里能找到。  
如果已经提交了真实邮箱，推送前可以改历史；首次提交最简单，直接设好再提交。

### 2.2 文档里的绝对路径

例如：

```text
C:\Users\你的用户名\Desktop\...
```

会暴露 Windows 用户名、目录结构。它不是密码，但属于个人信息。

发布前搜一遍：

```powershell
git grep -nE "C:\\\\Users|/Users/|/home/|Desktop"
```

本项目的操作文档应使用：

```text
cd path\to\MindCard
```

不要写真实本机路径。

### 2.3 截图

`docs/` 里的截图可能包含：

- 浏览器地址栏；
- 文件名/路径；
- 通知、头像、用户名；
- 课程内容。

发布前逐张检查，必要时打码或重拍。

### 2.4 密钥和配置文件

以下内容绝不能提交：

```text
.env
.env.*
*.pem
*.key
id_rsa
config.json（含 token）
```

本项目 `.gitignore` 已忽略 `.env`，但不要依赖它；提交前用：

```powershell
git status --short
git diff --cached --name-only
```

### 2.5 课程卡组已移出仓库

课程卡组现在在：

```text
MindCard/            # 公开仓库
../MindCard-private/ # 课程卡组、备份，完全不进 Git
```

这样即使误用 `git add -f`，也不会把课程内容带进公开历史。  
不要为了“方便”把它复制回 `MindCard/private/`；如果确实需要放回，至少加 pre-commit 拦截。

### 2.6 Token 不要写进 remote URL

不要：

```powershell
git remote add origin https://ghp_xxx@github.com/user/repo.git
```

token 会留在 `.git/config` 和命令历史里。  
用 `gh auth login`、Git Credential Manager 或 SSH。

---

## 3. 发布步骤

### 3.1 初始化并检查

```powershell
cd path\to\MindCard

git init
git branch -M main

git status --short --ignored

# 应该返回 False：仓库内不应再有 private/
Test-Path private

# 只预览，不真正加入
git add -n .
```

确认 `git add -n .` 里没有 `private/`，`Test-Path private` 为 `False`。

### 3.2 设置作者信息

```powershell
git config user.name "你的昵称"
git config user.email "12345678+username@users.noreply.github.com"
```

### 3.3 提交并推送

```powershell
git add .
git status --short

git commit -m "Initial public release"

git remote add origin https://github.com/<用户名>/<仓库名>.git
git push -u origin main
```

### 3.4 启用 Pages

1. 仓库 → Settings → Pages；
2. Source 选 **GitHub Actions**；
3. 确认默认分支是 `main`；
4. 等 Actions 的 `pages` 完成；
5. 打开 `https://<用户名>.github.io/<仓库名>/`。

---

## 4. 发布后的安全注意

### 4.1 Pages 同源

`https://<用户名>.github.io/<仓库名>/` 与同用户名下其他 Pages 项目共享 origin。  
其他项目页面里的 JS 可以读取 `mindcard:*` localStorage。

建议：

- 绑定独立自定义域名，例如 `mindcard.example.com`；
- 开启 HTTPS；
- 不要在同一个 origin 下放不可信项目。

### 4.2 私有仓库不等于私有网站

GitHub Pages 站点默认公网可访问。  
如果内容需要登录才能看，GitHub Pages 本身不够，需要 Cloudflare Access、自建登录或其他访问控制。

### 4.3 公开站点没有账号

访问者导入的卡组只存在他们自己的浏览器，不会上传到 GitHub。  
但共用电脑的其他人可以读到，页面应提示这一点。

### 4.4 公开仓库的代码可被复制

别人可以 fork、修改、重新部署。  
不要把自己的密钥、私有卡组、备份放进仓库。

---

## 5. 提交前检查清单

```powershell
git status --short
git diff --cached --name-only
git diff --cached --name-only | Select-String '^private/'
Test-Path private
git grep -nE "ghp_|github_pat_|sk-[A-Za-z0-9]|SUPABASE_SERVICE|password\s*=|api[_-]?key\s*="
git grep -nE "C:\\\\Users|/Users/|/home/|Desktop"
```

预期：

- `private/` 没有输出；
- `Test-Path private` 为 `False`；
- 没有密钥；
- 没有真实本机路径；
- 没有 `.env`、导出 JSON、备份文件。

首次推送后在 GitHub 网页确认：

- 根目录没有 `private/`；
- `decks/` 只有示例；
- `app/decks.js` 只有示例；
- 没有 `.env`、密钥、个人备份。

---

## 6. 如果已经误提交

1. 立即删除仓库或转私有；
2. 视为内容已泄露，不要只删文件；
3. 用 `git filter-repo` 清历史并 force push；
4. 检查 fork、缓存、搜索引擎；
5. 有 token/密码立即轮换；
6. 最稳：新建干净仓库，旧仓库删除。

---

## 7. 一句话

**GitHub 用户不能通过源码反向读取你电脑上的密码/API Key/浏览器数据；他们只能看到你提交过的内容和 Git 元数据。**  
发布前重点检查：作者邮箱、文档绝对路径、截图、仓库外私有目录、`.env` 和 token。
