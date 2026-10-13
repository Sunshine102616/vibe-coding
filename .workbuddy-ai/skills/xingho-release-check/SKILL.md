---
name: xingho-release-check
description: XingHo Read 项目（vibe coding）的发布前检查。在「把前端或后端推到公网之前」「部署之后要确认真的生效时」「一天收尾准备提交时」使用。按 R0–R5 六组 18 项逐条实跑并输出固定格式报告；R0 红线任何一条不过就不许发布。
---

# XingHo Read 发布前检查

## 这个 Skill 做什么

**发布前**按 R0–R5 六组共 18 项逐条**实跑**，输出固定格式报告。

它不解释「为什么要有这一项」——那些理由在项目文件里（`待办清单.md` 的踩坑表、`AGENTS.md`）。
本 Skill 只回答三个问题：**查什么、用什么命令查、什么算通过。**

## 铁律一：不抄具体值，只写「查什么、怎么判」

规则和数值只有**一处**来源。本 Skill 内**不得复制**色值、间距、数据库行数等具体规格。

**尤其不许写死「库里应该有 5 个文件夹」。** 理由：写死了，将来合法新增一个文件夹，
检查就会误报 —— 那时本 Skill 就变成了一份**说谎的文件**，和项目里被判为缺陷的「假成功」是同一类错误。

需要具体值时，**去读指出的文件**；判据要写成**规则**（如「不得命中测试数据特征」），不是**数字**。

## 铁律二：报告不许只说「没问题」

没跑过的项**必须**标「未执行」，不许写成「通过」。
跑不了的项要写清**为什么跑不了**（如「线上无法触发 500，只能本地验」）。

---

## 第 0 步：取环境信息（不要抄，去读）

```bash
grep -A 8 "P0-3" 待办清单.md
```

读出**环境 ID**、**云函数域名**、**静态托管域名**，后面命令里的 `<API>` / `<SITE>` 用它们替换：

- `<API>` = `https://<环境ID>.service.tcloudbase.com/api`
- `<SITE>` = `https://<环境ID>-<数字>.tcloudbaseapp.com`

> ⚠️ 环境 ID 从截图抄极易出错（`t` 看成 `5`、`d` 看成 `x`，Day 15 实际发生过）。
> **以 `待办清单.md` P0-3 的文本为准，不要靠读图。**

---

## 检查清单（18 项）

### R0　红线（任一条不过 = **不许发布**）

#### R0-1　密钥没进仓库

```bash
# 判据：搜的不是「密钥前缀」，而是「一个完整的 JWT 形状」
PAT='eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}'

# ① 被跟踪文件
git grep -nIE "$PAT"

# ② 未跟踪文件（--exclude-standard 会尊重 .gitignore，
#    所以 cloudbaserc.local.json 这类「合法存放密钥且已被忽略」的文件不会误报）
git ls-files --others --exclude-standard | while read f; do
  grep -nIE "$PAT" "$f" && echo "  ↑ 命中未跟踪文件：$f"
done

# ③ 全部历史提交
git grep -nIE "$PAT" $(git rev-list --all)
```

- **通过判据：三条都 0 行。**
- ⚠️ **只查被跟踪文件不够**（② 为什么必须有）：`git grep` **不扫未跟踪文件**。
  一个含密钥的新文件躺在工作区里，① 和 ③ 都看不见 —— 但只要有人跑一次 `git add -A`，它就进仓库了。
  **这是本 Skill 第一次实跑（Day 25）时发现的真漏检，不是假想。**
- ⚠️ **必须搜完整 JWT 形状，不能只搜 `eyJhbGci` 前缀**（① 为什么要写成这样）：
  项目文档里会**引用**这个前缀来解释「密钥长什么样」，
  只搜前缀会**误报**（Day 25 实测：`待办清单.md` 命中 3 处，全是文档在举例）。
  真密钥是**三段点分的 JWT**（Day 25 实测：80 / 754 / 342 字符）—— 文档里的 `eyJhbGci…` 没有点，不会命中。
- ⚠️ 为什么不搜 `publish_key`：它是**凭证类型的名字**，文档里讨论它必然命中。
- ⚠️ ② 里**不要**改成 `git ls-files --others`（不带 `--exclude-standard`）——
  那会把 `cloudbaserc.local.json` 一起扫进来，它是**该被忽略、也确实被忽略**的合法文件。

#### R0-2　`.gitignore` 覆盖敏感文件

```bash
for f in .env .env.local .env.development .env.production cloudbaserc.local.json; do
  git check-ignore -q "$f" && echo "✅ $f 已忽略" || echo "❌ $f 未忽略（会进仓库）"
done
```

- **通过判据：全部输出 ✅。**
- ⚠️ **看退出码，不要看 `git check-ignore -v` 的输出** —— 对 `!` 例外它**也会打印规则行**，
  光看输出会误判（Day 23 踩过）。`-q` 静默 + 看 `$?`：`0` = 被忽略，`1` = 未忽略。

#### R0-3　工作区干净 + 已推送

```bash
git status --short                       # 期望：空
git rev-parse main                       # 本地
cat .git/refs/remotes/origin/main        # 本地记录的远端
```

- **通过判据：`git status` 空，且两个 hash 相同。**
- ⚠️ 用 `.git/refs/remotes/origin/main` 比对 —— **比看 `git push` 的输出可靠**
  （Day 24：push 输出报错、实际推成功了，靠这个引用才发现）。
- 想确认远端真值（Steam++ 开着时会报证书错，属已知现象）：

```bash
git -c http.sslVerify=false ls-remote origin main
```

### R1　构建

#### R1-4　前端能构建

```bash
node node_modules/vite/bin/vite.js build
```

- **通过判据：退出码 0**，且 `dist/` 里生成了 `index.html` + `assets/`。

#### R1-5　后端语法正确

```bash
cd cloudfunctions/health && for f in index.js repo.js db.js http-utils.js; do
  node --check "$f" && echo "✅ $f" || echo "❌ $f 语法错误"
done
```

- **通过判据：四个全 ✅。**
- 为什么需要：本项目云函数**零依赖**、没有 lint，`node --check` 是唯一的语法兜底。

### R2　后端线上

#### R2-6　健康检查

```bash
curl -s --max-time 20 "$API/health"
```

- **通过判据：HTTP 200 且响应里 `"ok":true`。**

#### R2-7　读接口正常

```bash
curl -s --max-time 25 "$API/folders"
curl -s --max-time 25 "$API/materials"
```

- **通过判据：都是 200**，且字段名是**契约要求的 camelCase**（`folderId` / `sentenceCount`）。
- ⚠️ 数据库列是 `snake_case`、接口返回 `camelCase`，转换在 `repo.js`。
  **若看到 `folder_id` 漏出来，就是分层被破坏了。**

#### R2-8　写操作四类闭环

```bash
T="releasecheck-$(date +%s)"
curl -s -X POST   "$API/folders" -H "Content-Type: application/json" \
     -d "{\"id\":\"$T\",\"name\":\"发布检查\"}" -w "\n→ %{http_code}\n"   # 期望 201
curl -s "$API/folders" | grep -o "$T"                                        # 期望能查到
curl -s -X PATCH  "$API/folders/$T" -H "Content-Type: application/json" \
     -d '{"name":"改过之后"}' -w "\n→ %{http_code}\n"                      # 期望 200
curl -s -X DELETE "$API/folders/$T" -w "\n→ %{http_code}\n"                # 期望 200
curl -s "$API/folders" | grep -c "$T"                                        # 期望 0
```

- **通过判据：201 / 200 / 200，且最后一条 grep 计数为 0。**
- ⚠️ **跑完必须确认临时数据已删干净** —— 见 R4-15。

#### R2-9　错误提示是中文

```bash
curl -s -X POST   "$API/folders" -H "Content-Type: application/json" -d '{oops'   # 期望 400
curl -s -X PATCH  "$API/folders/nope-xyz" -H "Content-Type: application/json" -d '{"name":"x"}'  # 期望 404

# 409 要拿「一个真实存在的 id」去重复建 —— 从接口现取，不要写死某个 id
FIRST=$(curl -s "$API/folders" | grep -oE '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
curl -s -X POST "$API/folders" -H "Content-Type: application/json" \
     -d "{\"id\":\"$FIRST\",\"name\":\"重复\"}"                                   # 期望 409
```

- **通过判据：状态码对，且 `message` 里**有汉字**。**
- ⚠️ 这一项防的是「Day 23 的成果退回去」—— 曾经把 PostgREST 的
  `HTTP 401：permission denied for table folders` 这种**英文原文**直接给用户看。
- ⚠️ **不要写死 `listening` 这类 id**（见铁律一）：哪天它被删了，这条检查就永远跑不通。

#### R2-10　环境变量还在（只能间接证）

- **通过判据：R2-6 / R2-7 能返回真数据。**
- 这条**没有直接读法** —— `CLOUDBASE_API_KEY` 在云端函数里，本地读不到。
  但「接口能返回真数据」就说明它还在。
- ⚠️ 它是最隐形的一条：Day 18 被它坑了一整晚（控制台显示配置成功、运行时 `process.env` 里没有）。

### R3　前端线上

#### R3-11　公网首页 200

```bash
curl -s -o /dev/null -w "%{http_code}\n" --max-time 25 -H "Cache-Control: no-cache" "$SITE/"
```

- **通过判据：200。**
- ⚠️ **必须带 `Cache-Control: no-cache`** —— 否则 CDN 会拿缓存骗你，看不到真实状态。

#### R3-12　线上资源齐全

```bash
curl -s -H "Cache-Control: no-cache" "$SITE/" | grep -oE "assets/[^\"]+" | while read a; do
  curl -s -o /dev/null -w "$a → %{http_code}\n" --max-time 25 "$SITE/$a"
done
```

- **通过判据：每一个都 200。**
- 防的是「页面白屏」：index.html 引用的 JS/CSS 有一个 404，页面就是空的。

#### R3-13　线上 JS = 本地刚构建的 JS

```bash
curl -s -H "Cache-Control: no-cache" "$SITE/" | grep -oE "assets/[^\"]+"   # 线上
ls dist/assets/                                                            # 本地
```

- **通过判据：两边的文件名（含哈希）完全一致。**
- ⚠️ 这条防的是「**部署成功但线上还是旧版**」—— CLI 报成功只代表文件传上去了。
- 不一致时：CDN 还没刷新（等几分钟再试）／ 部署的是旧 `dist/`（重新 build 再 deploy）。

#### R3-14　浏览器实测

用 playwright 打开 `$SITE/`（**先过腾讯云「风险提醒」拦截页**：点「确定访问」），
再导航到目标 hash。**先过一次拦截让 cookie 落地，否则 hash 会被丢掉、抓到的全是首页。**

- **通过判据：**
  1. 页面 `title` 是 `XingHo Read`（不是「风险提醒」）
  2. 页面上出现真数据（如「课本音频」「听力训练」等文件夹名）
  3. **`pageerror`（未捕获异常）为空**
  4. 所有 4xx/5xx 的资源 URL **都不在 `assets/` 下**

- ⚠️ **不要用「console 里没有红字」当判据**（本 Skill 第一次实跑时写错过）：
  腾讯云拦截页**自己会返回 `404 /`**，浏览器照样在 console 里报一条红字 ——
  那不是项目的问题（Day 24 查清：导航响应 404、标题「风险提醒」，点「确定访问」后标题才变）。
  **看到红字先看 URL 和页面标题，再判断是不是自己的。**

### R4　数据卫生

#### R4-15　库里没有测试残留

```bash
curl -s --max-time 25 "$API/folders" | grep -oE '"id":"[^"]*"|"name":"[^"]*"'
```

- **通过判据：没有任何 id 或名字命中测试数据特征** —— `test-` / `tmp-` / `releasecheck-` / `day[0-9]+-` / 「测试」/「临时」。
- ⚠️ **判据是「规则」不是「数字」**。不要写死「必须 5 个」（见铁律一）。

#### R4-16　远端没有备份垃圾

```bash
tcb hosting list 2>&1 | grep -i "cloudbase-backup"
curl -s -o /dev/null -w "%{http_code}\n" "$SITE/.cloudbase-backup/"
```

- **通过判据：没有 `.cloudbase-backup/`。**
- 它从哪来：`tcb hosting deploy --safe` 的副作用，**不会自动清理**（Day 20 / 24 各留了一个）。
- CLI 若不列目录，用第二条 `curl` 探测。

### R5　文档

#### R5-17　`待办清单.md` 头行是今天

```bash
head -8 待办清单.md | grep "最近更新"
```

- **通过判据：日期 = 运行当天。**
- 为什么：这份表是每天开工先看的，头行过期等于明天从错误的状态出发。

#### R5-18　契约 = 实际路由

```bash
# ① 契约里「标了已实现」的行（注意：编号可能带 ** 加粗，如 | **10** |）
grep -nE "^\| *\*{0,2}[0-9]+\*{0,2} *\|" api-contract.md | grep "已实现"
# ② index.js 里实际存在的路由判定
grep -nE "pathname ===|pathname\.match" cloudfunctions/health/index.js
```

- **通过判据：契约里每个标 ✅ 的路径，都能在 `index.js` 找到对应判定；反之亦然。**
- ⚠️ **不要比「数量」**（本 Skill 第一次实跑时判据写错过）：
  契约表**同时列着未实现的规划项**，数量天然对不上。要比的是**对应关系**。
- ⚠️ grep 编号时要兼容 `**` 加粗 —— 表里第 10、11 行是 `| **10** |` 这种写法，
  `^\| [0-9]+ ` 会**漏掉它们**，看起来就像「契约里没登记」。
- ⚠️ `GET /api/health` **不在**契约的占位表里（它是运维用的，不属于产品接口）——
  这是**已知的例外**，不算不一致。

---

## 报告格式（固定）

检查完**必须**按这个格式输出，**不允许只说「已检查，没问题」**：

```
## 发布前检查报告

时间：<ISO 时间>　环境：<环境ID>
结论：✅ 可以发布 / ❌ 有 N 项未通过 / ⚠️ R0 红线未过，不许发布

| 组 | 结果 | 说明 |
|---|---|---|
| R0 红线 | ✅ 通过 / ❌ N 项未通过 | |
| R1 构建 | | |
| R2 后端线上 | | |
| R3 前端线上 | | |
| R4 数据卫生 | | |
| R5 文档 | | |

未通过明细：
1. [R0-1] <实际输出> —— 期望 <判据> —— 依据 <文件/规则>

未执行项（如有，写清为什么）：
1. <项> —— <原因>

修正建议：<改法>
```

**红线规则**：R0 任何一条不过 → 结论直接是「**❌ R0 红线未过，不许发布**」，
R1–R5 照跑但只作参考，**不得因为「其他都过了」就放行**。

---

## 发布动作本身的铁律（检查通过后才做）

| 动作 | 铁律 |
|---|---|
| 前端部署 | `tcb hosting deploy dist --safe --verify`。⚠️ **`--prune` 绝对不能用** —— 会删掉不属于本次发布的远端文件，把 `__auth/` 一起删 |
| 后端部署 | **凡碰这个函数的命令一律带 `--config-file cloudbaserc.local.json`** —— 只写 `-e <envId>` 会读主配置（里面没 Key），部署时把云端配置整体覆盖、**Key 被抹掉**（Day 18 让三个 GET 全变 500） |
| 任何部署 | **部署完必须真打一次接口/页面验证** —— 「CLI 说成功」≠「功能正常」 |
| 数据库新写操作 | 每新增一类写操作（`INSERT` / `UPDATE` / `DELETE`）都要补一次 `GRANT ... ON public.<表> TO anon;`，**只能在控制台点** |

---

## 什么时候不要用本 Skill

- 只是改代码、还没到发布 —— 那是 `xingho-conventions` 的活
- 只想看某个接口通不通 —— 直接 curl，不用走 18 项
- 用户明确说了「别检查，直接发」

## 自我维护

- 项目改了环境 ID / 域名 → **本文件不用改**（第 0 步是去读 `待办清单.md`，不是抄）
- 新增了一类反复要检查的项 → **补进上面的清单**，不要新建一个 Skill
- 发现本文件与项目文件描述冲突 → 以项目文件为准，并**立即修正本文件**
- 发现某项**长期跑不了**（如线上无法触发 500）→ 把它从清单里降级成「本地验证」，并注明

## 已知的调用问题

**新建的 Skill 在「当前会话」加载不了。** 技能发现机制在**会话启动时扫描一次**磁盘，
之后只查表 —— 所以本 Skill 若是本次会话里刚创建的，用 Skill 工具会返回「找不到」。

**这不是故障，是机制的正常行为**（Day 12 首次调用 `xingho-conventions` 时已查清，见 `Skill调用记录.md`）。

**处置**：加载不了时**不要停下** —— 手动 Read 本文件，按上面的清单**执行一遍**，
并在 `Skill调用记录.md` 追加一节留证（写清「降级调用」及原因）。
