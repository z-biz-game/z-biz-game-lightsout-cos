# 熄灯盘 - 交付报告

读者：接手的维护者代理。本文件只登记**磁盘上真实存在、且在本次会话里被命令跑绿过**的东西。
每条声称指到一个具体文件 + 一条能跑的命令；输出行是本机实跑后原样粘贴，未从 README/DESIGN 抄写。

本次会话**只新增三份文档**（`README.md`、`DESIGN.md`、`deliverable.md`）：没有修改任何代码/数据文件的**内容**，
没有新增功能，没有执行 git 写操作。**没有跑 `node tools/bake.mjs`**（它会覆盖 `js/data/lots.js`，不在本任务授权内），
下文所有"生成/接受率"类数字来自一条**只读复现**（只 import 核心、不写盘）与已出货的 `js/data/lots.js`，来源都逐条标出。

---

## 摘要

| 字段 | 值 | 复现命令 |
|---|---|---|
| **App 名称** | 熄灯盘 | `head -1 README.md` → `# 熄灯盘 · LIGHTSOUT`（取中文部分，与 `index.html:9` `<title>` 一致） |
| 仓 | `/Users/zifang/workplace/ceo_workplace/z-biz-game/z-biz-game-lightsout-cos` | — |
| 一句话玩法 | 一块 `n×n` 灯盘，按一格翻转它和上下左右，目标是把亮灯全按熄；每关印一个"最少按几次"的 `par` | `js/core/grid.js:57`（一次按键 = 一次异或） |
| 难度/par 的来源 | GF(2) 上 `M·x = b` 的**最小权解**，在 `2^nullity` 陪集里穷举；4×4 上再被按键图 BFS **全量 65536 盘**复核 | `node test/gf2-vs-bfs.test.mjs`（打印 `image 4096, diameter 7, mismatches 0`）；`js/core/gf2.js:133` |
| node 断言 | **9 个文件全 pass、0 fail；93 条命名用例（rows）、合计 21,147 次断言调用** | `node --test test/`（原文见 §验收结论） |
| 浏览器断言 | **本会话未跑**：`tools/verify.sh` 起 headless Chrome，属门控方职责，任务明令不在本机跑（当前有并发 Chrome 进程）。套件含 `@boot/@play/@routes/@save` 注入 + `@pointer` Node 侧真鼠标 | 见 §未实现清单 第 1 条 |
| npm 依赖 | `dependencies = {}`、`devDependencies = {}` | `node -e 'const p=require("./package.json");console.log(p.dependencies,p.devDependencies)'` |
| 二进制资产 | 0（无 png/mp3/字体；画面由 `js/view.js` canvas 2D 程序绘制） | `find . -type f ! -name '*.md' ! -name '*.js' ! -name '*.mjs' ! -name '*.cjs' ! -name '*.css' ! -name '*.html' ! -name '*.json' ! -name '*.sh' ! -name '*.yml'` → 只剩 `LICENSE`、`.gitignore` |
| 出货关卡 | 32 关（4 带 × 8）：4×4 16 关（微光+昏黄）、5×5 16 关（暗影+全熄） | `node -e "import('./js/core/library.js').then(m=>console.table(m.summaryTable()))"`（见 §数字从哪来） |
| 磁盘文件 | 37 个（不含 `.git`），其中 24 个 `.js/.mjs` 源/测/工，源码约 4.2k 行 | `find . -path ./node_modules -prune -o -path ./.git -prune -o -type f -print \| wc -l` |

---

## 文件清单与验证者

"由谁验证"只填**某个 `test/*.test.mjs` 的具体断言**或**一条能跑的命令**；填不出验证者的进 §未实现清单。

### 核心层 `js/core/*`（纯函数，`node --test` 直接 import，不碰 DOM）

| 文件 | 作用 | 由谁验证 |
|---|---|---|
| `grid.js` | 位掩码模型、十字邻域 `flipMask`、按两次=恒等、可交换、`validSize(3..7)` | `test/grid.test.mjs`（11 rows / 5077 asserts）："pressing a key twice is the identity"、"presses commute, so only the set matters"、"the cross neighbourhood is what the rules say" |
| `gf2.js` | GF(2) 消元：`toggleMatrix`/`getSolver`/核/陪集/`minPresses`/`certificate`/`imageCount` | `test/gf2.test.mjs`（14 rows）："rank/nullity ... size by size"、"the 4x4 kernel closes to 16 quiet patterns"、"the certificate really is a kernel vector with odd overlap"；对称性守卫 `gf2.js:58-60` |
| `solve.js` | `solve()`=出货 par；`bfsTable()`/`bfsPresses()`=对账用按键图 BFS | `test/solve.test.mjs`（10 rows）与 `test/gf2-vs-bfs.test.mjs`（10 rows，全扫描 65536 盘 mismatches 0）；"the 5x5 graph is too big to sweep" 断言 `bfsTable(5)` throws |
| `make.js` | 难度带（dial + 实测窗口）、`makePuzzle`、`REJECT_REASONS` | `test/make.test.mjs`（8 rows）："the ladder is four bands..."、"the band gate rejects a dial that lands outside its window"、"makePuzzle never writes into the tier it was given" |
| `library.js` | 查表战役/每日/单关、`validateLot` 逐行复算、`stats()`/`summaryTable()` | `test/library.test.mjs`（10 rows）："every printed par reproduces from the serialised board"、"the bands on screen are the bands in the file"、"a shared pick is the same pick" |
| `rng.js` | `hashSeed`（两轮 UTF-16，非教科书 FNV-1a）、`mulberry32`、`rngFrom` | `test/rng.test.mjs`（10 rows / 11981 asserts）："two rounds per character: ... knowingly not textbook FNV-1a"（钉 `hashSeed('a')=723832900`、`!== 3826002220`） |
| `game.js` | 对局状态机 `press/undo/redo/reset/grade/answerCells` | `test/game.test.mjs`（11 rows）："pressing the shipped answer in any order wins in exactly par presses"、"illegal presses are refused and cost nothing" |
| `storage.js` | 守卫式 localStorage、best 只降、unlock 只升、清档、损坏丢弃 | `test/storage.test.mjs`（9 rows）："with no localStorage ... still works in memory"、"unlocking is monotone and clearing really clears" |
| `data/lots.js` | 构建期产物：`TIERS_META` + 32 行实测 par | `test/library.test.mjs`（对磁盘行独立复算）+ 生成期 `tools/bake.mjs:77-89`（throw 门）——**本会话未重跑 bake**，见 §未实现清单 |

### 壳 / 视图 / 工具 / CI

| 文件 | 作用 | 由谁验证 |
|---|---|---|
| `index.html` | 壳：顶栏 / `#panel` 画布 / 面板 / 通关卡；`<link rel="icon" href="data:,">`（`index.html:8`） | 语法门 `npm run check`；运行时断言属 `@boot`（未跑，见未实现清单） |
| `css/game.css` | 全部样式，单文件 | 同上：`@boot` "canvas laid out"（未跑）；本会话仅静态存在 |
| `js/view.js` | canvas 绘制 + `cellCenter/cellRect/cellAt` 几何（供路由/手指/CDP 共用） | `@pointer` 真鼠标坐标取自它（未跑）；`test/game.test.mjs` 不含 view 语义 |
| `js/main.js` | 路由 `#/`,`#/daily`,`#/lot/<id>`（`parseRoute:51`）、DOM、存档写入、`window.lights`（`:397`） | `@routes`/`@save`/`@pointer`（未跑）；语法门 `npm run check` |
| `server.cjs` | 零依赖静态服务器，默认端口 5190（`:48,59`） | `npm run check`（语法）；`@boot` 起它轮询（未跑） |
| `electron/main.cjs` | 桌面壳，复用 `server.cjs`，`port:0` | **只有语法门** `npm run check` 的 `node --check electron/main.cjs`；未真实启动（见未实现清单） |
| `tools/bake.mjs` | 出题 → 复验 → 写 `lots.js`，打印秩表与接受/拒绝计数 | `npm run check`（语法）；产物由 `test/library.test.mjs` 复算——**本会话未运行它** |
| `tools/harness.mjs` | 微型框架 `test/ok/eq/run`，node/浏览器同形状 | 每个 `rows/asserts/fail` 行都是它打的（§验收结论） |
| `tools/playtest.mjs` | 零依赖 CDP：`@boot/@play/@routes/@save` + Node 侧 `@pointer`（`Input.dispatchMouseEvent`，`waitShell` 轮询） | 经 `verify.sh` 执行——**本会话未跑** |
| `tools/verify.sh` | 一次性验收门（支持 `SKIP_UNIT=1`） | 本会话按任务约束**未执行** |
| `test/fixture.mjs` | 手算锚点 `RANK_TABLE`/`IMAGE_COUNT`/`HAND`/`QUIET`/`PAIR_PRESS`/`UNSOLVABLE`，先于代码写死 | 被 `gf2`/`solve`/`gf2-vs-bfs` import；"no lighter press set exists — 3x3 exhaustively" |
| `test/*.test.mjs`（9 个） | 见上表各行的具体断言 | `node --test test/` → pass 9 / fail 0 |
| `.github/workflows/ci.yml` | unit job（`node --check` 全量 + 逐个 test）+ browser job（`SKIP_UNIT=1`） | 本机未执行 Actions；两条命令本地各等价于 §验收结论与（未跑的）浏览器层 |
| `.github/workflows/pages.yml` | 文件拷贝部署：`cp index.html` + `cp -r css js`（`:28-29`） | 本机未执行；被拷三样由套件覆盖 |
| `LICENSE` | MIT，`Copyright (c) 2026 z-biz-game` | `head -4 LICENSE` |
| `package.json` | `"type":"module"`、零依赖、`check/unit/test/bake/verify` 脚本 | `npm run check` rc=0 |
| `README.md` / `DESIGN.md` | 玩法 + 面向维护者的约束/踩坑 | 数字复现命令见 §数字从哪来；无自动门禁 |
| `deliverable.md` | 本文件 | 自身无门禁；内容指向下方实跑输出 |

---

## 数字从哪来

### A. 秩 / 零度 / 像集（只读，import `js/core/gf2.js`，与出货无关的锚点）

命令：
```
node --input-type=module -e "import{rankNullity,imageCount}from'./js/core/gf2.js';for(const n of[3,4,5,6,7]){const r=rankNullity(n);console.log(n+'x'+n,'rank='+r.rank,'nullity='+r.nullity,'image='+imageCount(n),'quiet=2^'+r.nullity+'='+(2**r.nullity))}"
```
输出：
```
3x3 rank=9  nullity=0 image=512      quiet=2^0=1
4x4 rank=12 nullity=4 image=4096     quiet=2^4=16
5x5 rank=23 nullity=2 image=8388608  quiet=2^2=4
6x6 rank=36 nullity=0 image=68719476736   quiet=1
7x7 rank=49 nullity=0 image=562949953421312 quiet=1
```
"每 16 个 4×4 盘面只有 1 个可解"（4096/65536）、"每 4 个 5×5 只有 1 个可解"（2^23/2^25）由此而来。

### B. 4×4 全量对账（`test/gf2-vs-bfs.test.mjs` 打印行，原样）

命令：`node test/gf2-vs-bfs.test.mjs`
```
sweep: 65536 boards, image 4096, diameter 7, mismatches 0 (2ms)
  ok   full sweep: coset minimum equals BFS distance on all 65536 boards
  ok   the distance histogram is the binomial triangle for as long as quiet patterns cannot reach
  ok   quiet patterns, brute-forced from the flip masks with no linear algebra at all
```
65536 个盘面里 61440 个不可解，两边都判不可解；可解的 4096 个陪集最小权 === BFS 距离，**0 处不一致**；
4×4 直径 7；纯穷举量出 quiet pattern 共 16、非空 15、最轻 8 键（`hist[1..3]=16/120/560=C(16,1..3)`）。

### C. 出货的 32 关（现量自 `js/data/lots.js`）

命令：`node -e "import('./js/core/library.js').then(m=>console.table(m.summaryTable()))"`
```
tier      label  board  lots  par    parMed  lit     dial
faint     微光   4x4    8     2-3    2       5-11    2-3
dim       昏黄   4x4    8     4-5    4       5-10    4-8
shadow    暗影   5x5    8     8-10   9       10-16   8-11
blackout  全熄   5x5    8     11-14  11      10-17   11-17
total lots 32
```
`par` = 实测区间（`TIERS_META`），`dial` = 生成器旋钮 `k` 的实际取值范围。dim 包络（make.js）为 4–7、出货落 4–5；
blackout 包络 11–15、出货落 11–14——包络与实际落成并排，不合并。

### D. 生成器接受率（**只读复现**，不写盘；非 `bake.mjs` 那次出货运行）

命令（只 import `js/core/make.js`，逐种子跑 `makePuzzle`，复刻 bake 的扫描但不落文件）：
```
node --input-type=module -e "import{TIERS,makePuzzle}from'./js/core/make.js';for(const t of TIERS){const seen=new Set();const r={};let a=0,c=0;for(let s=0;c<8&&s<480;s++){a++;const l=makePuzzle('bake-'+t.key+'-'+s,t.key);if(!l.ok){r[l.reason]=(r[l.reason]||0)+1;continue;}const k=t.n+':'+l.board;if(seen.has(k)){r.duplicate=(r.duplicate||0)+1;continue;}seen.add(k);c++;}console.log(t.key,t.n+'x'+t.n,'dial='+t.keys.join('-'),'win='+t.par.join('-'),c+'/'+a,Math.round(c/a*100)+'%',JSON.stringify(r))}"
```
输出：
```
faint     4x4 dial=2-3   win=2-3    8/9  89% {"duplicate":1}
dim       4x4 dial=4-8   win=4-7    8/10 80% {"out_of_band":2}
shadow    5x5 dial=8-12  win=8-10   8/9  89% {"out_of_band":1}
blackout  5x5 dial=11-17 win=11-15  8/14 57% {"out_of_band":6}
```
解读：简单带（dial ≤ 4/5×5 的 ≤7）几乎全接受——无足够轻的 quiet pattern 能 undercut；把 dial 拧高追难带窗口时
`out_of_band` 成为主拒绝源（blackout 每 14 抽才中 8 张）。这与 `js/core/make.js` 头注的"接受率是测量不是期望"一致。
注：这是**本会话的只读复现**，用于给读者一个能当场跑的数字；`tools/bake.mjs` 真正写 `lots.js` 那次运行的是同一套种子命名空间，
但其控制台输出未被本会话捕获（跑它会改写数据文件，不在授权内）。

### E. 确定性锚点（只读 import `js/core/rng.js`）
```
hashSeed('')  = 2166136261  (0x811c9dc5，offset basis，循环未跑)
hashSeed('a') =  723832900  (0x2b24d044)
教科书 FNV-1a('a') = 3826002220   ← 不等，设计如此
```

---

## 改动表（先写错在哪 → 为什么对）

来源标注：**[代码注释/DESIGN 已记]** = 这份代码里确实写过并记在注释或 DESIGN.md；**[家族教训]** = 契约 §1/§2 与同族仓踩过的坑，本仓一开始按教训写；**[规格主张]** = 简报 `/tmp/puzzle-brief/b2-lightsout.md` 的锚点。

| # | 曾经的错误 / 易错点 | 错在哪 | 为什么现在是对的 | 证据 |
|---|---|---|---|---|
| 1 | **[家族教训]** 把 `hashSeed` 当教科书 FNV-1a 并拿公开向量断言 | 它是 FNV-1a **派生的两轮 UTF-16 混合**（每 code unit 折低字节乘一次、再折高字节乘一次），ASCII 种子也对不上公开向量 | 契约 §1 明令"别叫它 FNV-1a"；断言只写自洽值：`hashSeed('')=2166136261`、`hashSeed('a')=723832900` 且显式 `!== 3826002220` | `js/core/rng.js:10-19` + 顶部注释；`test/rng.test.mjs` "two rounds per character: a variant, and knowingly not textbook FNV-1a" |
| 2 | **[代码注释已记]** 以为"按 k 个键 → par = k" | `ker(M)` 非零，4×4 上按 8 键的盘可能 4 键就熄——par 会被更轻的解悄悄 undercut | 难度带由**实测 par 窗口**定义，`k` 只是旋钮；`makePuzzle` 拿候选后用 `solve()` 量真 par，出窗即 `out_of_band` 拒 | `js/core/make.js` 头注 + `:68-71`；`test/make.test.mjs` "the band gate rejects a dial that lands outside its window" |
| 3 | **[代码注释已记]** 把不可解盘面当"未知"处理 | 不可解是一个**证明**（消元出现 `0 = 1` 的行），不是信息不足 | `solve` 返回 `{ok:false, certificate}`，`certificate` 是与盘面奇重叠的核向量；`getSolver` 若发现 `M` 不对称**直接 throw**，因为对称一破证书就不是证书了 | `js/core/gf2.js:58-60,127-130,134-137`；`test/gf2-vs-bfs.test.mjs` "a certificate from the sweep is a quiet pattern that overlaps the board oddly" |
| 4 | **[规格主张]** 只信代数一个来源 | 代数若算错（错主元 / 假陪集）不会自己报警 | 第二条独立腿：4×4 全 65536 盘 GF(2) 陪集最小权 vs 不用代数的按键图 BFS，mismatches 0 | 简报 §2；`test/gf2-vs-bfs.test.mjs`（本会话打印 `image 4096, diameter 7, mismatches 0`） |
| 5 | **[家族教训]** 把"生成包络"与"已发布 min/max"当同一个数 | 两者会静默合并，UI 印出从未落成的区间（gridlock 抄错过的格） | `make.js` 的 `TIERS` 是包络，`lots.js` 的 `TIERS_META` 是实际落成的 min/max；UI 印后者 | `tools/bake.mjs:132-145`；`test/library.test.mjs` "the bands on screen are the bands in the file" |
| 6 | **[代码注释已记]** 想给 5×5 也做全态 BFS | 2^25=33.5M 盘、像集 8.4M，扫它是几分钟几百 MB，且不增加证据**种类** | `bfsTable` 上界 `MAX_SWEEP_BITS=20`，5×5 **抛错而非钳制**；5×5 采样对账 | `js/core/solve.js:18,43`；`test/gf2-vs-bfs.test.mjs` "the 5x5 graph is too big to sweep, and the code says so instead of hanging" |
| 7 | **[本仓易踩]** shell/view 自己重推位布局 | 位布局是 `grid.js` 的知识，出现第二份位移就会与规则漂移 | 改盘面唯一入口是 `applyPress`/`press`；view 只提供几何 `cellCenter/cellRect` 不判合法性 | `js/core/grid.js:57`；`js/main.js:33-42` 的 `press`；`js/view.js` 头注 |
| 8 | **[家族教训]** `localStorage` 当"取不到就是 undefined" | `file://`/隐私模式下**碰属性就抛**，`setItem` 随时抛 Quota | 一切访问经守卫 `backend()`，抛错=退回内存不崩；清档连内存缓存一起换 | `js/core/storage.js:26-34,149-161`；`test/storage.test.mjs` "a localStorage that throws ... is a fallback, not a crash" |

---

## 验收结论

### `npm run check`（本会话实跑，rc=0）
```
> for f in js/*.js js/*/*.js server.cjs electron/main.cjs tools/*.mjs test/*.mjs; do node --check "$f" || exit 1; done && echo OK
OK
```

### `node --test test/`（本会话实跑）
```
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```
逐套件（`tools/harness.mjs` 打的 `rows / asserts / fail`）：
```
test/grid.test.mjs         rows: 11  asserts: 5077   fail: 0
test/rng.test.mjs          rows: 10  asserts: 11981  fail: 0
test/gf2.test.mjs          rows: 14  asserts: 741    fail: 0
test/gf2-vs-bfs.test.mjs   rows: 10  asserts: 1079   fail: 0
test/solve.test.mjs        rows: 10  asserts: 647    fail: 0
test/make.test.mjs         rows: 8   asserts: 742    fail: 0
test/library.test.mjs      rows: 10  asserts: 396    fail: 0
test/game.test.mjs         rows: 11  asserts: 415    fail: 0
test/storage.test.mjs      rows: 9   asserts: 69     fail: 0
```
合计：9 文件全绿、93 条命名用例、21,147 次断言调用、0 失败。

### `bash tools/verify.sh`（浏览器层）
**本会话未执行**（任务约束：本机有并发 headless Chrome，浏览器门控由 lead 负责，见 §未实现清单 第 1 条）。
其覆盖面为：node 层（同上一条）+ `@boot/@play/@routes/@save` 页面注入 + `@pointer` Node 侧真 `Input.dispatchMouseEvent`
把一条认证解点到熄。**通过数待 lead 门控后补录，本文件不预填。**

---

## 未实现清单（诚实列）

1. **浏览器层未在本会话跑**：按任务约束未执行 `tools/verify.sh` / `tools/playtest.mjs`（headless Chrome），
   `@boot/@play/@routes/@save/@pointer` 的实际通过数与 `=== ALL GREEN ===` 行**未捕获**，本文件如实留空而非编造。
2. **未重跑 `node tools/bake.mjs`**：它会覆盖出货数据 `js/data/lots.js`（不在"只写三份文档"授权内）。
   §数字从哪来 D 段是**只读复现**（同种子命名空间、不落盘），非那次真正写文件运行的控制台输出。
3. **Electron 壳未真实启动**：`electron/main.cjs` 仅过 `npm run check` 语法门；仓内不装 electron（README/DESIGN 已声明）。
4. **移动端未真机验证**：`css/game.css` 断点、`js/view.js` 的 `touch-action: none` 已写，无真机跑过。
5. **Actions 已实跑**：`ci.yml`（unit + SKIP_UNIT browser job）与 `pages.yml`（`cp index.html css js`）
   原本仅静态存在；发布后 GitHub Actions 已真实跑绿，见下面的「线上验收」一节。
6. 除以上外**无其它未实现项**：核心代数、对账 BFS、生成/复验、存档退化、确定性、视图几何均有对应已跑绿的 node 断言或只读复现命令支撑。

## 线上验收（GitHub Pages，主代理 2026-09-27 实抓）

发布 sha `7f9551c`，CI trigger `ceff4d0` → Actions `success`。

主代理自己的门禁复跑（不是任何子代理的转述）：`npm run check` rc=0；node **93 / 0 fail**；
浏览器 **92 / 0 fail** 且 `=== ALL GREEN ===` rc=0，逐段为
`@boot 14`、`@play 27`、`@routes 14`、`@save 16`、`@pointer 21`；`js/core/grid.js` 的 `allDark`
已从"幽灵导出"变为真被 `make.js`（起始盘）与 `library.js`（答案回放）引用。

| 资源 | 结果 |
| --- | --- |
| `/`（index.html） | 200 / 2,273 B |
| `js/main.js` | 200 / 16,518 B |
| `css/game.css` | 200 / 7,035 B |
| `js/data/lots.js` | 200 / 5,193 B |
| `<title>` | 与 README 首行一致（熄灯盘） |

浏览器段此前一片红（20 条失败）的根因值得留在文档里，因为它不是算法错、也不是渲染错：
CDP 驱动把 `view.cellCenter()` 返回的 **canvas CSS 像素**直接当作 `Input.dispatchMouseEvent` 的
视口坐标发出，于是每一次点灯都偏移了画布原点（约 `18,71`）——点到左上邻格，或干脆点到盘外
（角上那格点击后 press 计数为 0）。修法是在 `tools/playtest.mjs` 里加 `lampPoint()` 平移；
`view.js` 自己的契约（`cellAt()` 与 `main.js` 的 `clientX - rect.left` 同一坐标系）本来就自洽，
所以这是**测试侧**的错。另一处 `"2枚举 16 个陪集"` 是读数把数字与注解挤进同一个 `<dd>`，
现在数字独占 `<dd>`、注解进兄弟 `<small>`。
