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
  `par` 算，不看感觉（`js/core/game.js` 的 `grade`）。通关卡上会揭示那组被认证的最优键位。

## 难度是怎么被证明的

这是本仓的主张所在，一句话：**"能不能全熄"取决于盘面在不在矩阵的列空间里，"最少按几次"是解陪集里的最小权——两件事都在 GF(2) 上被精确算出，没有近似。**

一个盘面 `b` 能被全熄，当且仅当线性方程组 `M·x = b` 有解，当且仅当 `b` 落在翻转矩阵 `M` 的**列空间**里。
`M` 是对称的（十字邻域对称），对称性让"不可解"也能被**证书化**：消元后出现一行 `0 = 1`，那行对应的
核向量 `y` 与 `b` 有奇数重叠——`test/gf2-vs-bfs.test.mjs` 里逐条独立验回 `M·y = 0` 且 `y·b = 1`。
有解时，全部解构成 `ker(M)` 的一个**陪集** `x₀ + ker(M)`，恰好 `2^nullity` 个候选，"最少按几次"就是
这 `2^nullity` 个里最轻的那个——穷举它不是"搜不动"，而是陪集本来就只有 16（4×4）或 4（5×5）个元素。

**秩 / 零度是实测的、写死在测试里的锚点**（`test/fixture.mjs` 的 `RANK_TABLE`，`js/core/gf2.js` 现算并逐尺寸对账）：

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
生成器允许命中的**窗口**（`js/core/make.js`：faint 2–3 / dim 4–7 / shadow 8–10 / blackout 11–15）是**包络**，
UI 印的是**实际落成的 min/max**（`js/data/lots.js` 的 `TIERS_META`）：例如 dim 的包络是 4–7，8 关实际只落在 4–5；
blackout 包络 11–15，落在 11–14。两者并排存着、各测一次，`test/library.test.mjs` 会比对，防的是二者被静默合并。

## 本地运行

```bash
node server.cjs            # http://127.0.0.1:5190/  （ES module 需要 origin，file:// 被 CORS 挡）
npm run check              # 对每个 js/mjs/cjs 源文件与测试跑 node --check，全过输出 OK
npm run unit               # 逐个跑 9 个 node 测试套件（走 tools/harness.mjs 的计数）
npm test                   # check + unit
node tools/bake.mjs        # 重新出题 + 逐关复验，写 js/data/lots.js（会覆盖该数据文件，见下）
npx electron .             # 桌面壳（需自行 npm i -D electron，本仓不装）
bash tools/verify.sh       # node 层 + headless Chrome 真实点击验收（浏览器门控，CI browser job 用 SKIP_UNIT=1）
```

`server.cjs` 是零依赖静态服务器，默认端口 **5190**（`server.cjs:48,59`）。
`tools/bake.mjs` 是**构建期**内容管线：它对每个带跑一次 `makePuzzle` 扫描、把每条序列化的盘面重新 `solve()` 一遍、
在 4×4 上再用按键图 BFS 复核，任何一条对不上就直接 `throw`，全绿才写 `js/data/lots.js`——所以出货的关卡数据是"重新量了一遍"，不是手填。

## 测试

两层。**node 层本次实跑 `node --test test/`：9 个文件全部 `pass 9 / fail 0`；harness 打出 93 条命名用例（`rows`），合计 21,147 次断言调用（`asserts`），fail 0。**
每个套件（`node --test test/<file>` 单独跑）：

| 套件 | rows | asserts | 钉住的东西 |
|---|---|---|---|
| `grid.test.mjs` | 11 | 5077 | 十字邻域、翻转是自身逆、按键可交换（"只有集合相关"这句话的缩小版）、位工具 |
| `rng.test.mjs` | 10 | 11981 | `hashSeed` 两轮 UTF-16 混合、明确 **不是** 教科书 FNV-1a、`mulberry32` 逐流、确定性 |
| `gf2.test.mjs` | 14 | 741 | 秩表逐尺寸、像集 `2^rank`、核基有 nullity 个成员且都是 quiet pattern、证书、纯函数性 |
| `gf2-vs-bfs.test.mjs` | 10 | 1079 | **4×4 全扫描**：65536 盘陪集最小权 === 按键图 BFS 距离（mismatches 0）、像 4096、直径 7、quiet pattern 16/15/8 |
| `solve.test.mjs` | 10 | 647 | 手算 fixture、3×3 穷举反证"无更短解"、5×5 陪集恰好 4 个 quiet pattern、采样 5×5 对上 |
| `make.test.mjs` | 8 | 742 | 生成带、dial vs 实测窗口、拒绝词表恰好那四个、`makePuzzle` 不改入参 |
| `library.test.mjs` | 10 | 396 | 从序列化后的 `lots.js` 逐行复算 par、校验器负例、带不重叠、共享选盘可复现 |
| `game.test.mjs` | 11 | 415 | press/undo/redo/reset、非法按键免费、评星、`answerCells` |
| `storage.test.mjs` | 9 | 69 | 无 window 退化内存、best 只降、unlock 只升、清档真清、损坏存档丢弃 |

浏览器层由 `tools/verify.sh` 起一个真实 headless Chrome、经 `tools/playtest.mjs`（零依赖 CDP）跑：
`@boot @play @routes @save` 页面内注入 + **`@pointer` 在 Node 侧派发真实 `Input.dispatchMouseEvent`**，
坐标取自 `js/view.js` 的 `cellCenter()/cellRect()`，把一条认证解从头点到熄。浏览器层的通过数由门控方（`verify.sh` / CI browser job）
产出，本 README 只登记我实跑过的 node 层数字。

## 目录结构

```
index.html            壳：顶栏 / 画布 / 右侧面板 / 通关卡（含 data: favicon，防 404 污染 console）
css/game.css          全部样式，一个文件
js/core/grid.js       模型：n×n 位掩码、十字邻域 flipMask、按两次=恒等、可交换（无 DOM）
js/core/gf2.js        GF(2) 高斯消元：秩/零度/核/陪集/minPresses/证书（"最少按几次"在这里定案）
js/core/solve.js      solve()=GF(2) 出货值；bfsTable()/bfsPresses()=按键图 BFS，仅作对账
js/core/make.js       难度带（dial + 实测 par 窗口）+ 确定性出题 makePuzzle（只在 bake/test 里跑）
js/core/library.js    查表：战役 / 每日 / 单关 + validateLot 逐行复算 + stats()/summaryTable()
js/core/storage.js    localStorage 存档，touching 抛错时退化成内存
js/core/rng.js        两轮 UTF-16 混合的 hashSeed（非教科书 FNV-1a）+ mulberry32
js/core/game.js       对局状态机：press/undo/redo/reset/grade/answerCells（无 DOM）
js/data/lots.js       构建期产物：TIERS_META + 32 行带实测 par 的关卡（bake.mjs 写）
js/view.js            canvas 2D 程序绘制（一盏灯对应一个位）+ 指针几何，不判合法性
js/main.js            路由、DOM、存档写入、window.lights 测试钩子
server.cjs            零依赖静态服务器（默认 5190）
electron/main.cjs     桌面壳（复用 server.cjs，port:0）
tools/bake.mjs        出题 → 复验 → 写 lots.js，并打印秩表与实测接受/拒绝计数
tools/harness.mjs     微型测试框架，node 与浏览器套件输出形状一致（rows / asserts / fail）
tools/playtest.mjs    零依赖 CDP 驱动，@pointer 用真实 Input.dispatchMouseEvent
tools/verify.sh       一次性验收门（支持 SKIP_UNIT=1）
test/                 九个 node 套件 + 手算 fixture（期望值先于代码写死）
```

## 已知边界

- **不在点击时做任何搜索。** 运行时只做"应用一次按键（一次 XOR）+ 计数"；`par` 只在构建期由 `bake.mjs` 算并烤进数据文件。
  （即便陪集枚举只要十几个 XOR、快到可以现场跑，本仓仍把它锁在 bake 期，为的是稳定可分享的 id 与一份可 review 的实测记录。）
- **不做 5×5 全态穷举。** 2^25 = 33.5M 个盘面、像集 8.4M，`bfsTable(5)` 直接 `throw`（`MAX_SWEEP_BITS = 20`）；
  5×5 只采样复核（`test/solve.test.mjs`），理由写在 DESIGN.md 而不是藏起来。
- **不做非矩形 / 环形邻域变体。** 那会把整张秩表换成另一套，本文每个 `par` 数字随之失效（简报 §6）。
- Electron 壳过 `node --check`，但仓库不装 electron，**没有跑过真实启动**。
- 移动端断点已写、`touch-action: none` 已接，但**没有真机验证**。
- 多语言：UI 只有中文。

## License

MIT © 2026 z-biz-game
