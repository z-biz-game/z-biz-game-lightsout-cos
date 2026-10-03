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
本轮（2026-10-03）所有读数都来自这个 checkout（`git ls-files | wc -l` = 49，含本轮新增的那条闸
`tools/doctest.mjs` 与那台台账 `tools/sabotage.py`）。

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
| **本文印的每一个数都还等于现在的代码**（秩表、四带表、包络与落点、套件分账、腿清单、端口、脚本清单、CI 步、行号引用、追踪文件数） | `node tools/doctest.mjs` | 一组等式，每一条都配一句"解析到了几行"的反空转断言：正则没命中不是绿，是红；套件分账那一档是**真的把 9 套现跑一遍**再比文档。这条闸自己有几行等式不在本文里印（加了断言就会漂），它由命令自己打印，见门禁清单 | 见下面门禁清单的「文档闸」那一行；台账 L14–L22 九把刀逐条证明它咬得动，L23–L25 三把证明它不把散文当数 |
| 上面这条闸不是装饰品：它自己有一把刀，砍掉"有人在跑它"就红 | `python3 tools/sabotage.py` 的 L26–L29 | 在副本里分别摘掉 CI 的台账步、CI 的文档闸步、`package.json` 的 `sabotage` 脚本、README 里那句指向台账的话 | 四把都红在 `D12` 那条接线断言上，打印 `ci=缺 · pkg=在 · readme=在 · knife=在` 这样的分账（只缺一处、其余在位）|
| 一个语法错的文件不许上线 | CI 的 `Syntax` 步（`.github/workflows/ci.yml:24-25`），本地 `npm run check` | 对 `js/**`、`server.cjs`、`electron/main.cjs`、`tools/*.mjs`、`test/*.mjs` 逐个 `node --check` | `npm run check` → `OK`（本轮展开成 26 个文件） |

node 层合计本轮 **`rows: 94 / asserts: 21151 / fail: 0`**（9 个套件，见下面门禁清单的加总）；
浏览器层 **`rows: 92 / fail: []`**，`bash tools/verify.sh` 交回 `=== ALL GREEN ===`（退出码 0）。

## 破坏试验：把每条承诺真的破坏一次

台账住在仓里（`tools/sabotage.py`，`npm run sabotage`，CI unit job 里名为 `Ledger trips the assertion each knife names` 的那一步）。它在**仓库里的一个副本**
上动刀（`_sabotage-copy/`，已 gitignore，跑完 `shutil.rmtree` 删掉，真仓一行没改），每把刀只改**一个字段**：
替换前先断言 needle 在目标文件里恰好出现一次，打不中就报 `ERROR` 并计入不符——针打不中却写上一句"通过"，
是台账最坏的一种绿。然后跑它点名的套件/闸，要求**红，并且红在它点名的那条断言名上**（认的是 `FAIL` /
`未过：` 那行的**原文全等**，转述不算点名）。跑刀之前先把未破坏的副本整套跑一遍当基线，基线有红就直接退出 2：
否则后面每一枪的"红"都没有对照。共 **31 把**：11 把咬代数与引擎，2 把是产品侧"不该红"的对照（配色与文案），
9 把咬本文印的数，3 把是文档侧"不该红"的对照（改散文不许红），6 把咬"这条闸到底有没有人在跑"。

| 刀 | 破坏 | 跑什么 | 结果 |
|---|---|---|---|
| L1 | `gf2.js` 的陪集比较改成 `if (false)`（只认第一个候选） | `gf2-vs-bfs` + `library` | 红 4 条，点名 `full sweep: coset minimum equals BFS distance on all 65536 boards` |
| L2 | 不可解证书一律 `return null` | `gf2` | 红 2 条，点名 `a board nobody can solve is reported as unsolvable, with a checkable certificate` |
| L3 | `neighbours()` 少掉自己那一格 | `grid` | 红 4 条，点名 `the cross neighbourhood is what the rules say it is` |
| L4 | `grade` 把三星线挪到 `par+1` | `game` | **补用例之前这一枪全绿**；红 1 条：`三星的线正落在 par 上：多按一手就退成两星` |
| L5 | 存档 `best` 改成留最差 | `storage` | 红 3 条，点名 `best only goes down, perfect is sticky, plays only counts` |
| L6 | `hashSeed` 退回每字符一轮（教科书那副 FNV-1a） | `rng` + `library` | 红 2 条，点名 `two rounds per character: a variant, and knowingly not textbook FNV-1a` |
| L7 | 手改 `lots.js` 里一关的 `par`（2 → 3） | `library` | 红 6 条，点名 `every printed par reproduces from the serialised board` |
| L8 | `TIERS_META` 把 dim 上界从 5 写成 7 | `library` | 红 1 条：`the bands on screen are the bands in the file` |
| L9 | 每日选盘改成恒定第 0 关 | `library` | 红 1 条：`a shared pick is the same pick, and it is the pick the URL promises` |
| L10 | 生成窗口 dim 放宽到 `[4,9]` | `make` | 红 1 条：`the ladder is four bands, each with a key dial and a measured par window` |
| L11 | `isSolvable` 一律返回 `true` | `solve` | 红 1 条：`isSolvable agrees with solve, including on the boards that are not` |
| L12 | （**不该红**）改一盏灯的灯光颜色常量 `--lamp` | 全部 9 套 + 文档闸 | 无 —— 配色不是承诺，没有任何命令读 CSS 的那个字节 |
| L13 | （**不该红**）换掉首页那句存档说明的一个词 | 全部 9 套 + 文档闸 | 无 —— 文案不是承诺 |
| L14 | 文档印的追踪文件数比仓里少一个（49 → 48） | `tools/doctest.mjs` | 红 1 条：`D10 文档说的追踪文件数等于 git ls-files 现在的数（新增一个文件要一起改文档）` |
| L15 | 分账表把 `grid` 的 asserts 手抄成一个邻近的数（5077 → 5078） | 同上 | 红 1 条：`D4 grid 现跑 rows 11 / asserts 5077：文档那两格等于现测` |
| L16 | 四带表把昏黄的实测 par 区间写宽一格（4–5 → 4–6） | 同上 | 红 1 条：`D2 dim 那一行等于 summaryTable() 的现量（关数 / par / 中位 / 亮格 / 旋钮）` |
| L17 | 浏览器表少写一条腿（删掉 `@pointer` 那一行） | 同上 | 红 2 条：`D5a`（少一行）与 `D5b`（腿名集合不再等于 verify.sh 的那五条） |
| L18 | 端口表把 `WEB_PORT` 抄成 5191 | 同上 | 红 1 条：`D6 文档端口表等于 verify.sh 与 server.cjs 的默认值（换端口要三处一起换）` |
| L19 | 脚本清单少写一条 script | 同上 | 红 1 条：`D7 文档脚本表覆盖 package.json 的每一条（多一条少一条都红）` |
| L20 | 秩表把 4×4 的零度抄成 5 | 同上 | 红 1 条：`D1 4×4 秩 12 / 零度 4：文档那行等于锚点也等于现算` |
| L21 | 一条行号引用指到文件末尾之外（`game.js:83-88` → `8300-8800`） | 同上 | 红 1 条：`D9 文档里的每条 path:NN 引用都落在真实文件的行数内（写了行号就得还在文件里）` |
| L22 | CI 覆盖表声称有一条根本不存在的步 | 同上 | 红 1 条：`D8 python3 tools/sabotage.py 由 unit job 的「A step nobody wrote」这一步真的跑到` |
| L23 | （**不该红**）把一个小节标题换一个说法 | `tools/doctest.mjs` | 无 —— 标题不是数，闸不认它 |
| L24 | （**不该红**）在四带表后面补一句解释（表里每个数都没动） | 同上 | 无 —— 闸只认表格与等式里的数，多一行散文不该红 |
| L25 | （**不该红**）把"设计细节另见"换个说法 | 同上 | 无 |
| L26 | 摘掉 CI 里跑台账的那一步 | 同上 | 红 2 条：`D8 python3 tools/sabotage.py 由 unit job 的「Ledger trips the assertion each knife names」这一步真的跑到`（工作流里没有这一步）+ `D12`（打印 `ci=缺 · pkg=在 · readme=在 · knife=在`） |
| L27 | 摘掉 CI 里跑文档闸的那一步 | 同上 | 红 2 条：`D8 node tools/doctest.mjs …`（工作流里没有这一步）+ `D12`（`doctest_ci=缺`，其余五处在） |
| L28 | 摘掉 `package.json` 的 `sabotage` 脚本 | 同上 | 红 2 条：`D7 文档脚本表覆盖 package.json 的每一条`（README 还写着这条）+ `D12`（`pkg=缺`） |
| L29 | 把 README 里所有指向台账的话改掉（本轮七处一起） | 同上 | 红 1 条：`D12`（`readme=缺`，其余六处在）。这把用的是 `edit_all`：只改一处不会让那根线断，针数不对就当打不中 |
| L30 | 本地那道门的 `LOGIC_EXPECTS` 把 doctest 钉小 2 | 同上 | 红 1 条：`D13b`（打印 `钉 50 · 实跑 52`）。钉改小一条就够——门看见的是"闸变窄了"，不是"这次没跑到" |
| L31 | 摘掉 `tools/verify.sh` 里跑文档闸的那一行调用 | 同上 | 红 1 条：`D13d`（打印 `node 套件=1 · doctest=0 · sabotage=1`）。注释里提一句路径不算调用，这一条正是为了让"注释里写了"蒙不过去 |

第 4 把值得单独说：原来的 `test/game.test.mjs` 只测了 `par`（三星）、`par+2`（两星）和一个远超的
情形（一星），**`par+1` 那一档一次都没碰过**。于是"多按一手照样给三星"这个 bug 在门禁上是隐形的。
补的用例是摆状态给 `grade` 看的（而不是真去打这么一局）：出货盘上按不出"par+1 手就赢"——4×4 最轻的
非空 quiet pattern 要 8 个键，赢局的按键数只会从 `par` 直接跳到 `par+6` 往上——但 `grade` 是外壳随时
会调的纯函数，它那条线必须自己有用例。这也顺带把本文开头那句 `par+1`~`par+2` = ★★ 钉成了可测的事。

第 14–22 把是本轮新添的那一档：它们不改任何一行产品代码，改的是**本文自己印的字**。
在这一档之前，"文档抄错了数"这件事在这个仓里没有任何命令会失败——秩表、四带表、分账表、端口表
都可以一路抄到和代码无关。现在这九个数各有其一，而且第 23–25 把钉住反面：闸不许把散文也当数。

**这一轮台账把自己的三个洞咬出来了**（第一遍跑就是 13 把不符，每一把都改了台架或闸，没有一把是
靠"期望改一改"糊过去的）：

1. 副本目录原来叫 `_sabotage-copy/repo/`，于是 `D6b`（Pages 前缀 == 仓名）在**未破坏的基线**上就红——
   台架直接拒绝跑刀（基线红则 `exit 2`）。现在副本沿用真仓的目录名。
2. 点名用的是**全等**，可 `harness.mjs` 印的是 `  FAIL 名字`，正则抓到的名字带一个前导空格，
   于是 11 把引擎刀全部报"红但没点名"。这不是刀不咬，是台账读错了自己的证据——修的是抓取，不是期望。
3. `D9` 为了不把 `{grid,gf2,solve}.js` 这种花括号列举当成引用，把"前面是全角括号"的引用一起丢了，
   于是 L21（行号越界）该红却没红。现在只丢"没有目录分隔符且前面是逗号或花括号"的那种，
   被检查的行号引用从 10 条涨到 25 条——这 15 条之前是没人看的。

跑刀之前还有一道**预检**：31 把的 needle 先在未破坏的副本上逐一点数，对不上就一枪不跑、退出码 3，
并把每一条"现数 ≠ 期望"打印出来。它不是省时间（虽然确实省掉一整轮刀），它防的是**静默降级**：
一把针打不中的刀如果只报一句"跑不动"，下一次读台账的人看到的就是一个不再存在的证据。
本轮加完预检立刻抓到一次：L29 的针是"指认台账的那句话在本文出现几次"，我给文档补了新句子，针数就跟着漂——
预检在开头把"现数 ≠ 期望"报出来，而不是跑到第 31 把才发现针数不对。
预检自己也要能被证明会拦：在仓库外的副本里把 L29 的期望针数改大一个再跑，它退 3、一把刀都没跑、副本照样删掉
（跑法 `_tmp-lightsout-preflight-check.sh`，读数 `_tmp-lightsout-preflight-r1.log`，末行 `PREFLIGHT_RC=3`）。

第 26–31 把是接线刀。一把刀从没被 CI 跑过、一份闸从没被任何命令调用，和它不存在是同一件事，
所以这条接线（CI 的两步、`package.json` 的两条脚本、README 的那句指认）自己也得有一把能让它红的刀。
六把都只动**一处**：只摘 CI 那一步就够让 `D12` 红，另外三处还都写着"有人在跑"。

第 30–31 把钉的是**家门口的那道门**。CI 的 unit job 一直有跑文档闸与台账的两步，而本地那道
`bash tools/verify.sh` 以前一道逻辑闸都不跑——于是"本地全绿"和"CI 会绿"是两套眼睛，
改闸的人在自己机器上看不见它在 CI 里红的那一条。现在门也在家门口：它按脚本里 `LOGIC_EXPECTS`
那一行的两颗钉跑，而且 **`rc=0` 不算过**——闸变窄（明天有人删掉二十条断言）剩下的照样绿、
整道门照样 exit 0，所以钉的是每道闸自己的条数。这两颗钉不能自己证明自己，
`doctest` 的 `D13a`–`D13e` 反过来核对它从 `verify.sh` 读到的那一行（解析到几颗钉、本闸实跑几项、
台架现数几把刀、三道闸各有一条**真调用**、README 抄的那两个读数），L30/L31 再证明这一组真的会红。
CI 那一遍用 `SKIP_UNIT=1` 跳过这一段（那三步在 unit job 里各自是独立一步），
所以同一道门在两边跑的**是同一条**逻辑，而不是两份清单。
逐把的读数写在仓内的 `_tmp-verify/`（`.gitignore` 挡着），跑完不留第二棵树。

## 本地运行与脚本清单

```bash
node server.cjs            # http://127.0.0.1:5190/  （ES module 需要 origin，file:// 被 CORS 挡）
```

`package.json` 里 10 条 script，本轮每条都真跑过，右列是它这次的实际行为：

| script | 命令 | 本轮状态 |
|---|---|---|
| `start` / `dev` | `node server.cjs` / `node server.cjs 5190` | 可跑；只绑 `127.0.0.1`（`server.cjs:52`） |
| `check` | 对 `js/**`、`server.cjs`、`electron/main.cjs`、`tools/*.mjs`、`test/*.mjs` 逐个 `node --check` | `OK`（27 个文件，含本轮新增的 `tools/doctest.mjs`）。它靠 **shell 通配**展开，所以进不了某个目录时是"扫到 0 个文件"而不是报错 |
| `unit` | `for f in test/*.test.mjs; do node "$f"; done` | 9 个套件逐个跑，`rows: 94 / asserts: 21151 / fail: 0`。**别改成 `node --test test/`**：node 22（CI 那台）拿到目录参数时一个文件都找不到，只报一条名为 `test` 的失败，看起来像"测试跑了没通过"，其实一道都没跑 |
| `test` | `npm run check && npm run unit` | 绿 |
| `bake` | `node tools/bake.mjs` | 本轮**没有跑**（它会重写 `js/data/lots.js`）。它是构建期管线：出题 → 逐关复验 → 4×4 再用按键图 BFS 复核 → 全绿才写文件 |
| `verify` | `bash tools/verify.sh` | `=== ALL GREEN ===`，退出码 0（本文所有读数都来自这条） |
| `electron` | `electron .` | 仓库不装 electron，**没跑过**（见"不承诺"） |
| `doctest` | `node tools/doctest.mjs` | 文档数字闸：把本文印的每一个数与代码、套件、脚本现算的值逐个对账。本轮实测见门禁清单 |
| `sabotage` | `python3 tools/sabotage.py` | 破坏试验台账：31 把刀逐条证明上面那些闸真能让它们点名的断言红。跑完把 `_sabotage-copy/` 删掉 |

CI 的入口与本地是同一条命令（下表左边那列在终端里一样能跑）。文档里每一行"这条命令由 CI 的
哪一步跑"都由 D8 拿工作流的原文核对——步名不在那个工作流里，或者那一步跑的不是这条命令，就红：

| 命令 | job | CI 里的那一步 |
|---|---|---|
| `npm run check` | unit | `Syntax` |
| `npm run unit` | unit | `Suites` |
| `node tools/doctest.mjs` | unit | `Documentation figures` |
| `python3 tools/sabotage.py` | unit | `Ledger trips the assertion each knife names` |
| `bash tools/verify.sh` | browser | `Headless playtest` |

`unit` job 用 node 22；台账放在 unit 而不是 browser，因为这 31 把刀一把也不碰浏览器
（它们只点 node 套件与文档闸），而 browser 那步是 `SKIP_UNIT=1`。
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

文档闸 `node tools/doctest.mjs` 本轮读数 **`rows: 52 fail: 0`**；带上浏览器现量再跑
（`node tools/doctest.mjs --measured <json>`）是 **`rows: 58 fail: 0`**，多出来的 6 行就是
`D5d` 加五条腿的行数对比。这两个数由这条命令自己在末行打印，抄在这里只为对账；它不进上面任何等式，
因为断言一多这个数就漂——漂了也不算回归。

`rows` 是跑了多少条命名用例，`asserts` 是被钉住的条件数（`tools/harness.mjs` 两个数都打，
因为"十条用例每条一个断言"不等于十个检查）。注意 `asserts` 的大头在 `rng`（逐流比对）——
它是**比对次数**，不是"两千多种不同的性质"。

浏览器层由 `tools/verify.sh` 起一个真实 headless Chrome、经 `tools/playtest.mjs`（零依赖 CDP）跑，
五个套件各自报 `{rows, fail}`，加总是 **`14 + 27 + 14 + 16 + 21 = 92` 行、0 失败**。
本轮这一层是**重测过的**（临时把 `WEB_PORT` 换成 5192、`CDP_PORT` 换成 9343，读数在 `_tmp-lightsout-verify-r1.log`，
末两行 `=== ALL GREEN ===` / `VERIFY_RC=0`，`=== console ===` 那段是 `(none)`）：把每条腿的行数写成
`_tmp-lightsout-measured-103.json` 喂回文档闸，就是上面那条 `rows: 53`，五条 `D5 … 文档 N == 真 Chrome 量到的 N`
逐条现比——本轮 PWA 与 44×44 命中盒那两改动没有把任何一条腿的条数挪走：

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
