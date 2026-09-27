# 设计文档 · 熄灯盘

面向维护者的技术说明：为什么把"最少按几次"做成一次 GF(2) 陪集枚举、哪些约束一破就出 bug、
`hashSeed` 为什么"故意不是 FNV-1a"、难度带的那几个数字是哪一次实测产出的。玩法规则与关卡清单见
[README.md](README.md)，真实存在且已验证的东西与改动表见 [deliverable.md](deliverable.md)。

---

## 1. 模型：一个位向量，一次异或

盘面是**一个 `n×n` 位的 BigInt**，bit `i` = 第 `i` 格亮着；按键集合也是同形状的 BigInt，bit `j` = 按第 `j` 个键
（一格配一键，格 `j` 就是键 `j`）。`js/core/grid.js` 里三条事实撑起整个仓，并且都被 `test/grid.test.mjs` 钉住：

1. **按一个键 = 与一张固定掩码异或**（`applyPress`，`js/core/grid.js:57`），所以它是**自身逆运算**：按两次 = 没按；
2. **异或可交换**，所以决定盘面的**是按了哪些键（集合）**，与按的顺序无关；
3. 十字邻域掩码 `flipMask(n, j)`（`:39`）= 键自己 + 上下左右，被矩形裁剪；`flipMask(n, j)[i] === flipMask(n, i)[j]`，
   即**翻转矩阵 `M` 对称**。

尺寸合法域 `3 ≤ n ≤ 7`（`MIN_N`/`MAX_N`/`validSize`，`:12,13,156`）。为什么矩形是硬约束见第 8 节。

由 1、2 得：按一组键 `S` 的效果 = 把 `S` 的指示向量 `x(S)` 送进 `M`，盘面 = `M·x ⊕ b₀`。全部"能到达的盘面"
就是 `M` 的列空间（像）。**这就是关灯不是搜索问题、而是线性代数问题的根因。**

---

## 2. 求解器：GF(2) 高斯消元，为什么它赢过 BFS

`js/core/gf2.js` 的 `getSolver(n)`（`:53`）建矩阵并消元：

- 列 `cols = flipMasks(n)`；行 `rows` 由转置得到，`cols[i] !== rows[i]` 时**直接 throw**（`:58-60`）——
  第 5 节的不可解证书依赖对称性，对称一破证书就悄悄不再是证书，所以这里宁可崩。
- 对每一列做带回溯的消元（`:64-78`）：碰到没有主元的余式就是新主元列（记进 `pivots`），否则那条 `comb ^ (1<<j)`
  就是**核向量**（press 空间里 `M·y = 0` 的非零 `y`）。核基大小 = `nullity = size - rank`。
- 预先把**整个解陪集** `2^nullity` 个元素算出来（`:81-86`）。

`minPresses(board)`（`:133`）：

```
{rem, comb} = reduce(board)        // 不变式 rem === board ⊕ M·comb
if rem != 0:  不可解，返回 certificate（一条与 board 奇重叠的核向量）
else:         在 { comb ⊕ z : z ∈ coset } 里取 bitCount 最小者  ← 这一步就是 par
```

`comb` 是一个特解，`comb ⊕ z`（`z` 跑遍核）跑遍全部解；**取其中权重最小的那个，就是"最少按几次"**。
这不是下界、不是估计，是**在完整枚举了所有解之后**拿到的最小值。4×4 的陪集 16 个元素、5×5 的 4 个——
所谓"点题时做不动的搜索"，因为代数把搜索替换掉了，其实只要十几个异或。

实测秩表（`imageCount = 2^rank`）：

| n | rank | nullity | 像集（可解盘数） | 全盘数 | quiet pattern = `2^nullity` |
|---|---|---|---|---|---|
| 3 | 9 | 0 | 512 | 512 | 1 |
| 4 | 12 | 4 | 4096 | 65536 | 16 |
| 5 | 23 | 2 | 8388608 | 33554432 | 4 |
| 6 | 36 | 0 | 2^36 | 2^36 | 1 |
| 7 | 49 | 0 | 2^49 | 2^49 | 1 |

这五行是 `test/fixture.mjs` 的 `RANK_TABLE`（先于代码写死的锚点），`js/core/gf2.js` 现算并逐尺寸对回
（`test/gf2.test.mjs` "rank/nullity ... size by size"、"the count of solvable boards is 2^rank"）。

### 2.1 为什么不是 BFS，以及 BFS 还留在哪里

按键图 BFS 是**指数**的：4×4 有 `2^16 = 65536` 个盘面、5×5 有 `2^25 = 33.5M`。GF(2) 消元是多项式的
（`O(size²)` 个异或 + 枚举 `2^nullity ≤ 16`）。所以 `solve()`（`js/core/solve.js:25`）用代数，`par` 走它。

但**代数会不会算错**（一个错的主元、一条不是陪集的"陪集"）？只有拿一个完全不用代数的东西对它能证明。
于是 BFS 没有消失，它搬到了**对账**那一侧（`js/core/solve.js` 的 `bfsTable`/`bfsPresses`，`test/gf2-vs-bfs.test.mjs`）：

- `bfsTable(4)` 从全灭盘在按键图上做一次完整 BFS，读出每个盘面的真实最短距离、像集大小、直径、距离直方图；
- `test/gf2-vs-bfs.test.mjs` 对 **65536 个盘面逐一** 断言 `minPresses(陪集最小权) === BFS 距离`，
  不可解的必须**两边都判不可解**——实跑 **mismatches 0**、像集 4096、直径 7；
- 直方图前几档 `hist[1..3] = 16 / 120 / 560 = C(16,1..3)`（第 3 节解释为什么这里恰好是二项式），
  这是"代数与图一致"的又一枚独立证据。

`bfsTable(5)` 会**响亮地拒绝**（`MAX_SWEEP_BITS = 20`，`:18,43`）：5×5 的 33.5M 盘对 8.4M 像，扫它是几分钟和
几百 MB、且不提供任何**新种类**的证据。5×5 改用采样对账（`test/solve.test.mjs` "a sampled 5x5 sweep matches
the bounded graph walk"）。这个"不做全扫"的决定是**写下来**的，不是偷工的（简报 §2、§6）。

---

## 3. 出题：旋钮 `k`、实测窗口、以及 quiet pattern 为什么会"偷偷变短"

生成是平凡的：从全灭盘出发按 `k` 个不同的键（`js/core/make.js:46` `makePuzzle`），结果形如 `M·x`，
**必然在列空间里、必然可解**——不需要拒绝环去保证可解。

不平凡的是 **`par ≠ k`**。因为 `ker(M)` 非零（4×4 nullity 4、5×5 nullity 2），按 `k` 个键做出来的盘面，
**可能有一支更短的解**：4×4 上按 8 个键，盘面可能 4 按就熄。所以**难度带由"实测 par 窗口"定义**，
`k` 只是把它拧进窗口的旋钮：`makePuzzle` 拿到候选盘后用 `solve()`（代数）量出真 par，落在 `[par[0], par[1]]`
才出货，否则记 `out_of_band` 拒绝。

**为什么简单带几乎全接受、难带吃拒绝**：4×4 上最轻的**非空** quiet pattern 要 **8 个键**（`test/fixture.mjs`
`QUIET.minWeight`，`gf2-vs-bfs.test.mjs` 从 flip masks 纯穷举量出，无代数）。XOR 上一支核向量只会**降低或持平**
按键数、且当 `k ≤ 4`（4×4）、`k ≤ 7`（5×5）时没有足够轻的 quiet pattern 能 undercut——所以 faint/dim 的
低段能稳定落进窗口；把 `k` 拧高去追 shadow/blackout 的窗口时，就有相当比例的候选掉出窗外，被 `out_of_band` 拒。
`tools/bake.mjs` 把这些拒绝**打印出来**而不是藏起来。

拒绝原因恰好四个（`REJECT_REASONS`，`js/core/make.js:33`，`test/make.test.mjs` 钉死词表）：

| reason | 何时触发 | 现实里会吗 |
|---|---|---|
| `out_of_band` | 实测 par 落在窗口外 | 会，是难带的主要拒绝源 |
| `empty` | 按出全灭盘 | 非空键集配 quiet pattern 也回不到全灭，实测≈0；仍显式命名 |
| `duplicate` | 两支不同键集产生同一盘面 | 会（正是 quiet pattern 的存在使两支解同盘） |
| `unsolvable` | `isSolvable` 说不可解 | 构造上不可能，守卫留着让"不可解盘不出货"这句一直成立 |

### 3.1 唯一性与"深度"论据

一个可解盘面的解集是核的一个陪集，`2^nullity` 个元素；`minPresses` 里权重最小者**通常唯一**，
并列时用"取掩码数值更小者"确定性地裁决（`gf2.js:144` `w === bestWeight && x < best`）——所以**同一盘面永远
解出同一支最优键集**，出货的 `keys` 可复算（`test/library.test.mjs` "every printed par reproduces from the
serialised board"）。"两支解同盘 ⟺ 其对称差是 quiet pattern"这一事实，就是 `hist` 在 `d ≤ 3` 处恰好等于
`C(16,d)` 的原因（≤3 键的集合两两不同盘，因为最轻 quiet pattern 是 8 键），也是"每对双键盘 par 恰为 2"的原因
（`test/gf2-vs-bfs.test.mjs` "every two-key board on 4x4 has par exactly 2"，120 对全中）。

### 3.2 包络 vs 已发布

`js/core/make.js` 的 `TIERS` 是**生成包络**（带里允许哪些 par）；`js/data/lots.js` 的 `TIERS_META` 是
**8 关实际落成的 min/max**（`tools/bake.mjs:132-145` 从入库行里现量）。UI 印后者。例：dim 包络 4–7、实际落 4–5；
blackout 包络 11–15、实际落 11–14。两数并排、`test/library.test.mjs` "the bands on screen are the bands in the file"
比对，防的是二者被静默合并成一句。

---

## 4. 确定性：`hashSeed` 是两轮 UTF-16 混合，**故意不是 FNV-1a**

`js/core/rng.js`：`hashSeed`（`:10`）+ `mulberry32`（`:21`），与同族 gridlock 一字不差，好让全家族的种子指同一批数。

**关键陷阱**：`hashSeed` 对每个 UTF-16 code unit 做**两轮**乘异或——先折叠低字节乘一次 FNV prime，
再折叠高字节再乘一次。它是 FNV-1a **派生变体**，不是教科书 FNV-1a，因此**ASCII 种子也对不上公开向量**：

```
hashSeed('')   = 2166136261   (0x811c9dc5，offset basis——循环一次没跑，唯一还等于教科书的输入)
hashSeed('a')  =  723832900   (0x2b24d044)
教科书 FNV-1a('a') = 3826002220   ← 两者不等，这是设计，不是 bug
```

契约 §1 明说"不要叫它 FNV-1a"。`test/rng.test.mjs` 因此**不拿公开向量当"应等于"**，只写自洽断言：
`''` 恰为 offset basis、`'a'` 钉死到 723832900 并断言 `!== 3826002220`、纯 `>>>0` 落 32 位内、
同种子两次调用相等、不同种子分布开。要改 `hashSeed` 之前先读 `test/rng.test.mjs` 顶部那段——
一旦真的换成教科书 FNV-1a，所有已烘焙的 id 选盘、每日题、分享链接都会指到不同盘面（`test/library.test.mjs`
"a shared pick is the same pick, and it is the pick the URL promises" 会红）。

选盘都走 `hashSeed`：战役/随机用 `hashSeed('salt|seed') % 池长`（`js/core/library.js:63`），
`#/daily` 用 `hashSeed('daily|YYYY-MM-DD')`（`dailyLot`，`:91`），所以任何设备同一天得到同一盘。生成侧
`makePuzzle` 用 `rngFrom('tier|seed')`（`js/core/make.js:48`），`(seed, tier)` 与盘面一一映射。

---

## 5. 视图与手势层

`js/view.js` 只画像素、不判合法性。一盏灯对应盘面的一个位；按一个键点亮 `js/core/grid.js` 描述的那个十字——
**画面必须与代数逐格一致**，所以图元全程序绘制（无图片/精灵/字体）。

几何是**公共契约**的一部分：`cellCenter(i)` / `cellRect(i)` / `cellAt(x,y)`（经 `window.lights` 暴露，
`js/main.js:416-419`）把格序号 ↔ 像素双向映射。这意味着**手指点格 7、路由切到格 7、CDP 派发一个落在格 7 的
`Input.dispatchMouseEvent`——三者是同一个键**。`@pointer`（第 6 节）能存在全靠这里几何是公开且唯一的。

对局状态机 `js/core/game.js` 是纯的：`press`（`:33`）是**唯一**改盘面的动作，一次异或 + 一次计数；
被拒绝（越界 / 已通关后）时**什么都不改也不计数**（`test/game.test.mjs` "illegal presses are refused and cost nothing"）。
`undo` 不是特例——它就是再按一次那个键（可交换、自身逆），栈只为诚实地数"按了几下"和让重做能走。

存档 `js/core/storage.js` 走**守卫式**访问：`localStorage` 在 `file://` 与某些隐私模式下"碰属性就抛 SecurityError"，
`setItem` 随时可能抛 Quota，所以一切经 `backend()`（`:26`），抛错 = 退回内存而非崩溃。`best` 只降、`perfect` 粘滞、
`unlock` 单调升、清档连内存缓存一起换（`:149`），损坏/异形状存档直接丢弃（`test/storage.test.mjs` 全绿）。

---

## 6. 验证台架

### 6.1 两层，同一个形状

`tools/harness.mjs` 是微型框架（`test/ok/eq/run`），node 与浏览器套件打**同形状**的 `rows / asserts / fail` 行，
`verify.sh` 才能用同一套花括号计数解析。node 层 `node --test test/` 实跑 9 文件 pass、93 rows、0 fail。

### 6.2 `@pointer` 为什么必须存在

页面内注入的断言能证明 `press()`/`solve()` 对，**证明不了手指点得着某个格**。`tools/playtest.mjs` 的
`@pointer`（`SCENARIOS` 外的 Node 侧场景，`:132,172`）在 Node 里用 `Input.dispatchMouseEvent` 派发真鼠标，
坐标从页面 `window.lights.cellCenter(i)` 取，断言：整条认证解用真点击走完、原地点击不动、非法位置点击不动、
终点判定与 `par` 一致。`@boot @play @routes @save` 是页面内注入的另四段。

### 6.3 家族教训（契约 §2，本仓一开始就照做）

- **导航后轮询 shell，不 `sleep()`**：`waitShell()`（`tools/playtest.mjs:102`）轮 `window.lights` 的状态；
  固定 sleep 打线上就是假故障（canvas 停在未样式化的默认 300×150）。
- **`verify.sh`**：Chrome 用 `mktemp -d` 独立 profile；轮 `/json/version` **和** web 根都活再开始；
  `trap cleanup EXIT` 里 `wait` 掉后台 PID；结果 JSON 用**花括号计数**从 console 截；支持 `SKIP_UNIT=1`（CI browser job）。
- **`<link rel="icon" href="data:,">`**（`index.html:8`）：否则 favicon 404 污染"console 干净"断言。

---

## 7. 一破就出 bug 的约束清单

| 约束 | 破了会怎样 | 钉在哪 |
|---|---|---|
| `M` 必须对称（矩形十字邻域） | 不可解证书失效，`getSolver` 主动 throw | `js/core/gf2.js:58-60`；`test/gf2.test.mjs` "the toggle matrix is symmetric" |
| 秩表不许从被测代码读回 | par 变成"代码自说自话"，BFS 对账失去独立锚 | `test/fixture.mjs` `RANK_TABLE`/`IMAGE_COUNT`/`QUIET` 手抄 |
| `hashSeed` 不许改成教科书 FNV-1a | 所有已烘焙 id / 每日题 / 分享链接指向别的盘 | `test/rng.test.mjs` 钉 `'a' → 723832900` 且 `!== 3826002220` |
| 出货 par 必须从序列化后的行复算 | 手改 `lots.js` 里一个数字就能骗过生成期 | `js/core/library.js:24` `validateLot`；`test/library.test.mjs`、`tools/bake.mjs:77-89` |
| UI 印的是 `TIERS_META` 不是 `TIERS` | 包络与实际落成静默合并（gridlock 抄错过的格） | `test/library.test.mjs` "the bands on screen are the bands in the file" |
| 5×5 不许现场全扫 | boot/点击时卡死 | `solve.js:18` `MAX_SWEEP_BITS`；`gf2-vs-bfs` 断言 `bfsTable(5)` throws |

---

## 8. 刻意不做的东西

- **不做环形 / 不规则邻域**：十字邻域对称 → `M` 对称 → 不可解可证书化、秩表是本仓每个数字的锚。
  换成环面或异形，`RANK_TABLE` 整张作废，全部 par 要重测（简报 §6）。
- **不做 5×5（及更大）全态穷举**：`bfsTable` 上界写死 `2^20`，5×5 = 2^25 直接抛错而非钳制；只采样对账。
- **不做点击时现场搜索**：par 只在 bake 期算，运行时只做"一次异或 + 一次计数"。
- **不加成就 / 排行榜 / 签到 / 云存档 / 分享战绩**（组织 E 组禁令）。分享只有 `#/lot/<id>`，分享谜题本身、不带分数。
- **无图片 / 音频 / 字体 / 打包器 / npm 依赖**：`dependencies` 与 `devDependencies` 都是 `{}`，二进制资产 0 个。
- **不做多语言**：UI 只有中文。
