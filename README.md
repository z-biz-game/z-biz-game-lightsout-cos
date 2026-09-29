# 熄灯盘 · LIGHTSOUT

把一块点亮的格子全部按熄。`js/core/gf2.js` 是"最少按几次"这个数字真正被算出来的地方，
本仓与一般点灯谜题的关键区别只有一条：**屏幕上每一个 `par` 都是 GF(2) 上 `M·x = b` 的最小权解，
在一个只有 `2^nullity` 个元素的陪集里逐个穷举得到的——不是估值、不是启发式、不是搜索器给自己打分。**

关灯只有一个动作：按一个键，它会把自己和上下左右四格各自翻转（亮↔灭）。两件事让这个动作变成代数：
按两次等于没按（翻转是自身逆运算），而且按的顺序无所谓（异或可交换）——所以决定盘面的是
"**按了哪些键**"这个集合，而不是按的顺序。于是"能不能全熄"和"最少按几次"都是线性方程组的问题。

- **谁算了屏幕上的每个数字**：`js/core/gf2.js` 对十字邻域矩阵做高斯消元，`js/core/solve.js` 的
  `solve()` 用它取陪集里最轻的解，`tools/bake.mjs` 把每关的 `par` 量出来写进 `js/data/lots.js`，
  `test/library.test.mjs` 再在每次 CI 里从磁盘上那行十进制数**重新解一遍**复算。
- 这个数字**不是关灯游戏自己说的**：`test/gf2-vs-bfs.test.mjs` 对 4×4 把 `2^16 = 65536` 个盘面全部走两遍——
  一遍 GF(2) 陪集最小权、一遍完全不用代数的按键图 BFS——两条腿在 65536 个盘面上（含 61440 个不可解的）**零处不一致**。
- 零依赖、零美术、零打包器：只有 `index.html` + `css/` + `js/`，浏览器加载的就是仓库里的文件。
- 32 关已烘焙并逐关复验，四个难度带互不重叠，带边界是从**实测 par** 切出来的（生成器的窗口只是旋钮）。
- 战役 `#/` / 每日 `#/daily` / 单关 `#/lot/<id>` 三种入口，同一个 id 或同一天在任何设备上都是同一个盘面。
- 本地存档（localStorage），无账号、无网络请求、可离线。

## 玩

- 一块 `n×n` 的格子，每个格子上有一盏灯（点亮 / 熄灭）。点一个格子就是**按它一次**：
  它自己和上下左右四格同时翻转。没有长按、没有二级操作。
- 目标：把所有亮着的灯全部按熄（盘面归零）。面板实时印 `已按 / par`——`par` 就是这一关的**最少按键数**。
- 撤销 / 重做走同一条 `press()`（因为按两次等于没按，撤销只是再按一次那个键）；重置把盘面、计数、
  历史栈一起归位。
- 打平"最少"（`已按 ≤ par`）= ★★★ 最优熄灯；`par+1`~`par+2` = ★★；再多 = ★。星级只对着量出来的
  `par` 算，不看感觉（`js/core/game.js:83-88` 的 `grade`）。通关卡上会揭示那组被认证的最优键位。

## 难度是怎么被证明的

这是本仓的主张所在，一句话：**"能不能全熄"取决于盘面在不在矩阵的列空间里，"最少按几次"是解陪集里的最小权——两件事都在 GF(2) 上被精确算出，没有近似。**

一个盘面 `b` 能被全熄，当且仅当线性方程组 `M·x = b` 有解，当且仅当 `b` 落在翻转矩阵 `M` 的**列空间**里。
`M` 是对称的（十字邻域对称），对称性让"不可解"也能被**证书化**：消元后出现一行 `0 = 1`，那行对应的
核向量 `y` 与 `b` 有奇数重叠——`test/gf2-vs-bfs.test.mjs` 里逐条独立验回 `M·y = 0` 且 `y·b = 1`。
有解时，全部解构成 `ker(M)` 的一个**陪集** `x₀ + ker(M)`，恰好 `2^nullity` 个候选，"最少按几次"就是
这 `2^nullity` 个里最轻的那个——穷举它不是"搜不动"，而是陪集本来就只有 16（4×4）或 4（5×5）个元素。

**秩 / 零度是实测的、写死在测试里的锚点**（`test/fixture.mjs:7-13` 的 `RANK_TABLE`，`js/core/gf2.js` 现算并逐尺寸对账）：

| 尺寸 | rank | nullity | 可解盘数 = `2^rank` | 全盘数 `2^(n²)` | 可解比例 | quiet pattern 数 = `2^nullity` |
|---|---|---|---|---|---|---|
| 3×3 | 9 | 0 | 512 | 512 | 全部可解 | 1（只有空集，解唯一） |
| 4×4 | 12 | **4** | **4096** | 65536 | 每 16 个盘 1 个可解 | **16**（15 个非空，最轻 8 键） |
| 5×5 | 23 | **2** | 8388608 | 33554432 | 每 4 个盘 1 个可解 | **4**（3 个非空） |
| 6×6 | 36 | 0 | 2^36 | 2^36 | 全部可解 | 1 |
| 7×7 | 49 | 0 | 2^49 | 2^49 | 全部可解 | 1 |

`quiet pattern` = 按下去什么都不变的按键集合（核里的元素）。它是"最少按几次"能不能被更短解悄悄 undercut 的根源：
4×4 上最轻的**非空** quiet pattern 要 **8 个键**，所以任何 ≤3 键的按键集合都给出互不相同、且 par 就等于键数的盘面——
`test/gf2-vs-bfs.test.mjs` 用这事实断言距离直方图前几档恰好是二项式 `C(16,1)=16 / C(16,2)=120 / C(16,3)=560`，
并说：4×4 上"每 16 个盘面只有 1 个能全熄"，可解的那 4096 个盘里最难的也需要 **7 按**（实测直径 = 7）。

游戏把 **4×4 和 5×5 出货**——正是两个 nullity 非零、因而 par 真正需要代数才能算准的尺寸；
3×3、6×6、7×7 在秩表里（`validSize` 允许 3..7）但 nullity = 0，随机盘几乎必然可解且解唯一，作为难度锚点没有信息量。

**已出货的 32 关按实测 par 分四带**（下表是 `js/data/lots.js` 里那 32 行现算出来的，不是抄的规格；
复现：`node -e "import('./js/core/library.js').then(m=>console.table(m.summaryTable()))"`）：

| 带 | 尺寸 | 关数 | 实测 par 区间 | par 中位 | 亮格数区间 | 生成器旋钮 `k` |
|---|---|---|---|---|---|---|
| 微光 faint | 4×4 | 8 | 2–3 | 2 | 5–11 | 2–3 |
| 昏黄 dim | 4×4 | 8 | 4–5 | 4 | 5–10 | 4–8 |
| 暗影 shadow | 5×5 | 8 | 8–10 | 9 | 10–16 | 8–11 |
| 全熄 blackout | 5×5 | 8 | 11–14 | 11 | 10–17 | 11–17 |

合计 4×4 出货 16 关（微光 8 + 昏黄 8），5×5 出货 16 关（暗影 8 + 全熄 8）。"关数"和"par 区间"都是从磁盘上那 32 行现量的——
生成器允许命中的**窗口**（`js/core/make.js:24-29`：faint 2–3 / dim 4–7 / shadow 8–10 / blackout 11–15）是**包络**，
UI 印的是**实际落成的 min/max**（`js/data/lots.js:6` 的 `TIERS_META`）：例如 dim 的包络是 4–7，8 关实际只落在 4–5；
blackout 包络 11–15，落在 11–14。两者并排存着、各测一次，`test/library.test.mjs` 会比对，防的是二者被静默合并。

## 承诺表：每条承诺都指着会让它红的那条命令

左列是本仓对外说的话，中列是**本轮真的跑过、并且真的能让它红**的命令，右列是这次的实际读数。
本轮（2026-09-30）所有读数都来自这个 checkout（`git ls-files | wc -l` = 38，含本轮新增的那条用例）。

| 承诺 | 会让它红的命令 | 它到底在比什么 | 本轮实测 |
|---|---|---|---|
| 屏幕上每个 `par` 都是陪集最小权，不是启发式 | `node test/gf2-vs-bfs.test.mjs` | 4×4 的 **65536 个盘面逐个**比：GF(2) 陪集最小权 === 按键图 BFS 距离，第二套实现一个代数都不 import | `rows: 10 fail: 0`；破坏试验第 1 枪（`minPresses` 只认第一个候选）红在 `full sweep: coset minimum equals BFS distance on all 65536 boards` |
| 不可解盘给的是**证书**，不是"我搜不到" | `node test/gf2.test.mjs` | 残余行给出的核向量 `y` 逐条验回 `M·y = 0` 且 `y·b = 1` | `rows: 14 fail: 0`；第 2 枪（证书改成 `return null`）同时红 2 条，点名 `a board nobody can solve is reported as unsolvable, with a checkable certificate` |
| 烘好的 32 行是"重新量过的"，不是手填 | `node test/library.test.mjs` | 从序列化那行的 `board` 现算 `minPresses`，与印在旁边的 `par` 比 | `rows: 10 fail: 0`；第 7 枪（把 faint-01 的 `par` 手改成 3）红在 `every printed par reproduces from the serialised board` |
| 难度带互不重叠，屏幕上那条带 == 文件里量出来的那条 | 同上 + `node test/make.test.mjs` | `TIERS_META` 的 `[min,max]` 必须等于 32 行现算的 min/max，且后一档的 min 严格大于前一档的 max | 第 8 枪（dim 的 `max` 从 5 放宽到 7）**只红 1 条**：`the bands on screen are the bands in the file` |
| 同一天 / 同一个 id 在任何设备上都是同一个盘 | 同上 | 测试自己按公布规则重算一遍下标：`hashSeed('daily\|<date>') % 32`，再与 `dailyLot(date)` 比 | 第 9 枪（选盘改成恒定 `list[0]`）红在 `a shared pick is the same pick, and it is the pick the URL promises` |
| 三星只发给"打平 par"的人，多按一手就退星 | `node test/game.test.mjs` | `grade` 的四档边界：`par` / `par+1` / `par+2` / `par+3` 各一条 | `rows: 12 fail: 0`。**这条本轮才有闸**：见下面破坏试验第 4 枪 |
| 存档 `best` 只会变小、`perfect` 粘住、`plays` 只加 | `node test/storage.test.mjs` | 假 localStorage：写进去再读回来、单调性、清档真清、坏档/未来形状不信 | `rows: 9 fail: 0`；第 5 枪（best 改成留最差）红在 `best only goes down, perfect is sticky, plays only counts` |
| `hashSeed` 不是教科书 FNV-1a（它是分享链接稳定的地基） | `node test/rng.test.mjs` | 每字符两轮 UTF-16 混合的**逐位期望值**，另把游戏用到的每颗 seed 钉到第二套实现 | `rows: 10 fail: 0`（这一套就占了 11981 次断言）；第 6 枪（抹掉第二轮）红在 `two rounds per character: a variant, and knowingly not textbook FNV-1a` |
| 生成器只出货"带内、可解、不重复"的盘 | `node test/make.test.mjs` | 拒绝原因词表必须**恰好**是 `bake.mjs` 打印的那四个，多一个少一个都算红 | `rows: 8 fail: 0`；第 10 枪（dim 的窗口放宽到 `[4,9]`）红在 `the ladder is four bands, each with a key dial and a measured par window` |
| 每一关都能用真鼠标点完、点数与星级都对 | `bash tools/verify.sh` 的 `@pointer` | CDP `Input.dispatchMouseEvent` 发**真**事件，坐标取自 `js/view.js` 的 `cellCenter()`，从不叫 `window.lights` 代劳 | `rows: 21 fail: []`；全程 `(no console output)` |
| 一个语法错的文件不许上线 | CI 的 `Syntax` 步（`.github/workflows/ci.yml:24-25`），本地 `npm run check` | 对 `js/**`、`server.cjs`、`electron/main.cjs`、`tools/*.mjs`、`test/*.mjs` 逐个 `node --check` | `npm run check` → `OK`（本轮展开成 26 个文件） |

node 层合计本轮 **`rows: 94 / asserts: 21151 / fail: 0`**（9 个套件，见下面门禁清单的加总）；
浏览器层 **`rows: 92 / fail: []`**，`bash tools/verify.sh` 交回 `=== ALL GREEN ===`（退出码 0）。

## 破坏试验：把每条承诺真的破坏一次

台架在仓库外的副本上做（`_tmp-lightsout-copy/`，用完即删，真仓一行没改）：每枪只改**一个字段**，
替换前先断言 needle 在目标文件里恰好出现一次，否则当场中止；然后跑点名的套件，要求它**红，并且红在
预期的那条用例名上**。另有两枪是"不该红"的——它们证明台架不是在把所有改动一律判红。
脚本：工作区根 `_tmp-lightsout-sab.py`，日志 `_tmp-lightsout-sab.log`，末行 `=== 判定 13 枪 / 与预期不符 0 ===`。

| # | 破坏 | 结果 |
|---|---|---|
| 1 | `gf2.js` 的陪集比较改成 `if (false)`（只认第一个候选） | 红 4 条，点名 `full sweep: coset minimum equals BFS distance…` |
| 2 | 不可解证书一律 `return null` | 红 2 条，点名 `a board nobody can solve is reported as unsolvable…` |
| 3 | `neighbours()` 少掉自己那一格 | 红 4 条，点名 `the cross neighbourhood is what the rules say it is` |
| 4 | `grade` 把三星线挪到 `par+1` | **改之前这一枪全绿**；补了边界用例之后，红 1 条：`三星的线正落在 par 上：多按一手就退成两星` |
| 5 | 存档 `best` 改成留最差 | 红 3 条，点名 `best only goes down, perfect is sticky, plays only counts` |
| 6 | `hashSeed` 退回每字符一轮（教科书那副 FNV-1a） | 红 2 条，点名 `two rounds per character…` |
| 7 | 手改 `lots.js` 里一关的 `par`（2 → 3） | 红 6 条，点名 `every printed par reproduces from the serialised board` |
| 8 | `TIERS_META` 把 dim 上界从 5 写成 7 | 红 1 条：`the bands on screen are the bands in the file` |
| 9 | 每日选盘改成恒定第 0 关 | 红 1 条：`a shared pick is the same pick…` |
| 10 | 生成窗口 dim 放宽到 `[4,9]` | 红 1 条：`the ladder is four bands…` |
| 11 | `isSolvable` 一律返回 `true` | 红 1 条：`isSolvable agrees with solve, including on the boards that are not` |
| 12 | （**不该红**）改灯光的颜色常量 `--lamp` | 无 —— 配色不是承诺，没有用例读 CSS |
| 13 | （**不该红**）换掉首页那句存档说明的一个词 | 无 —— 文案不是承诺；用例只查 `blurb` 里有没有"按"字 |

第 4 枪值得单独说：原来的 `test/game.test.mjs` 只测了 `par`（三星）、`par+2`（两星）和一个远超的
情形（一星），**`par+1` 那一档一次都没碰过**。于是"多按一手照样给三星"这个 bug 在门禁上是隐形的。
补的用例是摆状态给 `grade` 看的（而不是真去打这么一局）：出货盘上按不出"par+1 手就赢"——4×4 最轻的
非空 quiet pattern 要 8 个键，赢局的按键数只会从 `par` 直接跳到 `par+6` 往上——但 `grade` 是外壳随时
会调的纯函数，它那条线必须自己有用例。这也顺带把本文开头那句 `par+1`~`par+2` = ★★ 钉成了可测的事。

## 本地运行与脚本清单

```bash
node server.cjs            # http://127.0.0.1:5190/  （ES module 需要 origin，file:// 被 CORS 挡）
```

`package.json` 里 8 条 script，本轮每条都真跑过，右列是它这次的实际行为：

| script | 命令 | 本轮状态 |
|---|---|---|
| `start` / `dev` | `node server.cjs` / `node server.cjs 5190` | 可跑；只绑 `127.0.0.1`（`server.cjs:52`） |
| `check` | 对 `js/**`、`server.cjs`、`electron/main.cjs`、`tools/*.mjs`、`test/*.mjs` 逐个 `node --check` | `OK`（26 个文件）。它靠 **shell 通配**展开，所以进不了某个目录时是"扫到 0 个文件"而不是报错 |
| `unit` | `for f in test/*.test.mjs; do node "$f"; done` | 9 个套件逐个跑，`rows: 94 / asserts: 21151 / fail: 0`。**别改成 `node --test test/`**：node 22（CI 那台）拿到目录参数时一个文件都找不到，只报一条名为 `test` 的失败，看起来像"测试跑了没通过"，其实一道都没跑 |
| `test` | `npm run check && npm run unit` | 绿 |
| `bake` | `node tools/bake.mjs` | 本轮**没有跑**（它会重写 `js/data/lots.js`）。它是构建期管线：出题 → 逐关复验 → 4×4 再用按键图 BFS 复核 → 全绿才写文件 |
| `verify` | `bash tools/verify.sh` | `=== ALL GREEN ===`，退出码 0（本文所有读数都来自这条） |
| `electron` | `electron .` | 仓库不装 electron，**没跑过**（见"不承诺"） |

CI 那两条入口（`.github/workflows/ci.yml`）：`unit` job 跑 Syntax + 9 套件（node 22），
`browser` job 用 `SKIP_UNIT=1 WD_TIMEOUT=240` 跑 `tools/verify.sh`。`.github/workflows/pages.yml` 没有构建步骤，只是 `mkdir _site` 然后拷 `index.html`、`css/`、`js/`
（`server.cjs`、`electron/`、`tools/`、`test/` 都不上线），`actions/configure-pages@v5` 之后由
`actions/deploy-pages@v4` 部署。所以线上那份是**文件拷贝**，任何只在 node 侧跑得起来的东西都不会上线。

## 门禁清单：本轮逐条复跑

`for f in test/*.test.mjs; do node "$f"; done` → **`rows: 94 / asserts: 21151 / fail: 0`**。
每个套件单独跑一遍的分账（本轮实测）：

| 套件 | rows | asserts | 套件 | rows | asserts |
|---|---|---|---|---|---|
| `grid` | 11 | 5077 | `make` | 8 | 742 |
| `rng` | 10 | 11981 | `library` | 10 | 396 |
| `gf2` | 14 | 741 | `game` | **12**（本轮 +1） | 419（+4） |
| `gf2-vs-bfs` | 10 | 1079 | `storage` | 9 | 69 |
| `solve` | 10 | 647 | **加总** | **94** | **21151** |

`rows` 是跑了多少条命名用例，`asserts` 是被钉住的条件数（`tools/harness.mjs` 两个数都打，
因为"十条用例每条一个断言"不等于十个检查）。注意 `asserts` 的大头在 `rng`（逐流比对）——
它是**比对次数**，不是"两千多种不同的性质"。

浏览器层由 `tools/verify.sh` 起一个真实 headless Chrome、经 `tools/playtest.mjs`（零依赖 CDP）跑，
五个套件各自报 `{rows, fail}`，加总是 **`14 + 27 + 14 + 16 + 21 = 92` 行、0 失败**：

| 套件 | rows | 钉住的东西（照 `tools/playtest.mjs` 里各条 row 名归纳，条数按本轮实测） |
|---|---|---|
| `@boot` | 14 | 壳直起一局、画布真有像素、灯**真的被画出来了**（读像素采样）、烘焙池与每档实测带都载入、面板印出 已按 / 最少 / 还剩 / 最佳 |
| `@play` | 27 | 对局状态机在真页面上的行为：一次按键的成本与翻转形状、同一个键按两下、撤销与重做、重开、答案行、三星/两星/一星三种收尾与通关卡 |
| `@routes` | 14 | `#/`、`#/lot/<id>`、`#/daily` 各自开对盘；未知 id 是错误态而不是白屏；同一条 daily 路由两次给同一个盘 |
| `@save` | 16 | 过关真的落到 `localStorage`（不是只有内存）、清档之后为空、解锁与货架可点、totals 行数就等于解过的关数 |
| `@pointer` | 21 | **真鼠标事件**：坐标取自 `js/view.js` 的 `cellCenter()` 并先平移画布原点，把认证解从头点到熄；全程不叫 `window.lights` 代劳 |

`=== console ===` 那段本轮是 `(no console output)` —— 零控制台错误。

## 分层

```
js/main.js          路由、DOM、存档写入、window.lights 测试钩子 —— 唯一碰 DOM 的地方之一
js/view.js          canvas 2D 程序绘制 + 指针几何（cellCenter/cellRect），不判合法性
js/core/game.js     对局状态机：press/undo/redo/reset/grade/answerCells（无 DOM）
js/core/library.js  查表：战役 / 每日 / 单关 + validateLot 逐行复算 + stats()/summaryTable()
js/core/{grid,gf2,solve,make,rng,storage}.js  代数与出题，纯函数，构建期跑
js/data/lots.js     构建期产物：TIERS_META + 32 行带实测 par 的关卡（bake.mjs 写）
```

"运行时只做一次 XOR"这条线是刻意画的，但要说准：`gf2.js` 与 `solve.js` **确实在浏览器的模块图里**
（`js/core/library.js:14` import `getSolver`、`js/core/game.js:11` import `patternCells`），
只是开局与按键的路径一个高斯消元都不跑 —— `getSolver` 只被 `validateLot()` 调用，而 `validateLot`
只有 `test/library.test.mjs` 在调；`patternCells` 只是把已经烘好的键集换成 1-based 坐标。
`js/core/make.js` 则连浏览器都不 import（只有 bake 与测试用它）。
不这样切的话，同一个 id 在不同机器上会给出不同的 `par` 展示时机，关卡数据也不再是一份可 review 的实测记录。

## 存档

进度、最佳按键数、是否"完美"、解锁到第几关都写在这台设备的 localStorage
（键 `lightsout.save.v1`，`js/core/storage.js:10`）。没有账号、没有网络请求、没有导出/导入按钮
（只有 `#/` 面板上那个清档 `wipe`，它由 `@save` 真点过）。
`localStorage` 整个不可用、`getItem` 抛错、或 `setItem` 半路爆配额时都只降级成内存档，不炸给玩家
（`test/storage.test.mjs` 的 9 条里三条专测这条路）。损坏或来自未来形状的档按能读的部分读，
读不懂就丢，不会拿半截数据当真。

## 端口与 URL 形态

| 用途 | 值 | 定义处 |
|---|---|---|
| 手工试玩 | `http://127.0.0.1:5190/` | `server.cjs:48,59`（`PORT` 环境变量或 argv[2] 可换） |
| 本地复验 | `WEB_PORT=5190`、`CDP_PORT=9341` | `tools/verify.sh:15-16`，可被同名环境变量覆盖 |
| 页面内路由 | `#/`（战役）、`#/daily`、`#/lot/<id>` | `js/main.js:51-58`，认不出来返回 `mode: 'unknown'` |
| 线上 | `https://z-biz-game.github.io/z-biz-game-lightsout-cos/` | Pages 带仓名前缀，所以 `css/`、`js/` 一律写相对路径 |

`tools/verify.sh:31-35` 在起任何东西之前先探两个端口：DevTools 已经被占（第二台 Chrome 会**静默并进
第一台的调试口**）或者 `$BASE` 已经有人应答，都直接退出 5。这不是洁癖——同一台机器上有好几个会话的
复验在跑，替我们答话的那台不是我们的站，跑完的 92 行就成了别人的读数。

## 不承诺 / 已知边界

写得越少，越容易被当成写了。这里明确不承诺的：

- **不在点击时做任何搜索。** 运行时只做"应用一次按键（一次 XOR）+ 计数"；`par` 只在构建期由 `bake.mjs` 算并烤进数据文件。
- **不做 5×5 全态穷举。** 2^25 = 33.5M 个盘面、像集 8.4M，`bfsTable(5)` 直接 `throw`（`MAX_SWEEP_BITS = 20`）；
  5×5 只采样复核（`test/solve.test.mjs`），理由写在 DESIGN.md 而不是藏起来。因此上面那句"两条腿零处不一致"
  **只对 4×4 成立**，5×5 的那条腿是采样，不是全扫描。
- **"每档都出得了题"这类承诺不适用。** 本作不现场出题：出货的是 32 行固定数据，`make.js` 只在 bake/test 里跑。
- **浏览器层只走两关**（`@pointer` 打 dim-01 与 faint-01），不是 32 关全点。其余 30 关由 node 层的
  `library`/`gf2-vs-bfs` 复算；"每一关都能用真手势点完"这句话的严格版本没有闸。
- **`rows: 94` 不是"94 条独立性质"**，`asserts: 21151` 也不是。它们是本次实跑的计数，用来核对
  "套件有没有静默少跑文件"，不是质量分。
- **视觉与文案没有闸**：破坏试验第 12、13 枪实测不红。配色（`css/game.css`）与界面措辞改了不会有任何命令失败，
  所以别把它当成"验证过好看"。屏幕阅读器、色觉无障碍同样没有承诺。
- **"运行时不搜索"这条只有代码结构在守**，没有一条用例断言"点击路径上不调用 `solve`"。
- **WebAudio / 音效**：本作没有音效，因此也没有相关承诺。
- **Electron 壳过 `node --check`，但仓库不装 electron，没有跑过真实启动。**
- **移动端断点已写、`touch-action: none` 已接，但没有真机验证**；`@pointer` 发桌面鼠标事件。
- **不做非矩形 / 环形邻域变体。** 那会把整张秩表换成另一套，本文每个 `par` 数字随之失效。
- **多语言：UI 只有中文。**
- **墙钟不是承诺。** 本文不出现"多少毫秒能玩"。65536 盘全扫描那套在机器忙时会更慢，
  但它没有任何毫秒上界，慢到什么时候都不算回归。

## 设计细节另见

[`DESIGN.md`](DESIGN.md)（代数与口径的推导）、[`deliverable.md`](deliverable.md)（交付说明）、
[`技术债登记.md`](技术债登记.md)（已知欠账，逐条带"谁会为它红"）。

## License

MIT © 2026 z-biz-game
