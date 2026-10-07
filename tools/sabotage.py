#!/usr/bin/env python3
# 破坏试验台账：把整仓拷进 _sabotage-copy/（已 gitignore，真仓一行不改），每把刀只改一个字段，
# 跑它点名的套件/闸。每把都必须"红，并且红在它自己那条断言名上"；五把阴性对照必须全绿。
#
# 为什么要这份文件：引擎断言、烘焙数据、文档数字都有命令去重测，但"那些命令到底能不能失败"
# 本身没有闸。这里逐条回答它。
#
# 刀是一张表，不是一堆 lambda：每把刀写清楚"在哪个文件里把哪段换成哪段、那段现在该出现几次"，
# 于是跑刀之前的预检和真正动刀读的是同一份描述。若把针只写在 lambda 里，预检就得另抄一遍，
# 两处一漂，预检就变成第二个会说谎的人。
#
# 输出末两行 `rows: N fail: M` 是给 CI 读的：M 只跟着"与预期不符"走，
# 所以一把刀咬不动（该红却没红）和一份日志里全是红，在这里是同一类失败。
import glob
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COPY = os.path.join(ROOT, '_sabotage-copy')
# 副本那一层要沿用真仓的目录名：D6b 拿 basename(仓根) 与 README 里那句 Pages 前缀对账，
# 拷成 repo/ 就等于改了仓名，基线会红一条与刀无关的红（本轮就是这么发现的）。
REPO = os.path.join(COPY, os.path.basename(ROOT))
PRISTINE = os.path.join(COPY, 'pristine')

SUITES = sorted(f'test/{os.path.basename(p)}' for p in glob.glob(os.path.join(ROOT, 'test', '*.test.mjs')))
GATE = 'tools/doctest.mjs'
# 接线刀（L26-L29）共用的期望红名：砍掉任何一处"有人在跑"，红的都必须是这一条。
WIRE = 'D12 台账与文档闸都接进了 CI 和 package.json，而且接线自己有一把刀（砍掉任何一处它就只是一段代码）'
# 所有套件 + 文档闸：阴性对照（"不该红"）要跑遍它们，否则少跑一个套件就等于没测。
EVERYTHING = SUITES + [GATE]


def snapshot():
    for d in (REPO, PRISTINE):
        if os.path.isdir(d):
            shutil.rmtree(d)
    os.makedirs(COPY, exist_ok=True)
    for d in (REPO, PRISTINE):
        # .git 要一起拷：D10 数的是 git ls-files，副本里没有 .git 就会把"文档数字过期"
        # 混进每一把文档刀的红里，那红就不是这把刀咬出来的了。
        shutil.copytree(ROOT, d, ignore=shutil.ignore_patterns('node_modules', '_sabotage-copy', 'verify-shots'))


def restore():
    if os.path.isdir(REPO):
        shutil.rmtree(REPO)
    shutil.copytree(PRISTINE, REPO)


def read_in(base, path):
    with open(os.path.join(base, path), encoding='utf-8') as f:
        return f.read()


def write_in(base, path, text):
    with open(os.path.join(base, path), 'w', encoding='utf-8') as f:
        f.write(text)


def dose(needles, base=REPO):
    """把一把刀的每一处替换落进 base。expect 不是"恰好一次"的那种地方只有 L29 一处：
    README 指认台账的话写在好几处，只改一处不会让那根线断，所以那把要先数出全部的处数。"""
    for path, needle, repl, expect in needles:
        src = read_in(base, path)
        n = src.count(needle)
        if n != expect:
            raise RuntimeError(f'needle 在 {path} 出现 {n} 次（要 {expect} 次）：{needle[:70]!r}')
        write_in(base, path, src.replace(needle, repl))


def preflight():
    """跑刀之前，先把每一把的针在未破坏的副本上点一遍数。
    针数不对 means 文档或代码改了字、台账没跟着改——那种情况一枪不跑：
    跑到第 29 把才报"针打不中"，前面 28 把的红已经白跑，而台账会拿一把根本没咬到的刀说"与预期不符"。"""
    gaps = []
    for kid, _what, needles, _files, _want in KNIVES:
        for path, needle, _repl, expect in needles:
            now = read_in(PRISTINE, path).count(needle)
            if now != expect:
                gaps.append(f'  {kid} {path} 现数 {now} ≠ 期望 {expect}：{needle[:70]!r}')
    return gaps


def run(files):
    """跑点名的文件，返回 (fail 计数, 红的断言名列表, 原始输出)。"""
    bad, names, raw = 0, [], []
    for rel in files:
        r = subprocess.run(['node', rel], cwd=REPO, capture_output=True, text=True, timeout=900)
        out = r.stdout + r.stderr
        raw.append(f'--- {rel} (rc={r.returncode})\n{out}')
        m = re.search(r'rows: (\d+) fail: (\d+)', out)
        if m:
            bad += int(m.group(2))
        else:
            bad += 1 if r.returncode else 0
            raw[-1] += '\n!! 没打印 rows/fail 行'
        # 套件印 `FAIL <用例名>`，文档闸印 `未过：<等式名>`——两边都只认整行原文，不做子串匹配。
        # 冒号/FAIL 后面那个空格不是名字的一部分：留着它，"点名"就变成永远对不上的全等。
        names += re.findall(r'^\s*(?:FAIL|未过：)\s*(.+?)\s*$', out, re.M)
    return bad, names, '\n'.join(raw)


# (刀号, 说明, 针 [(文件, 原文, 替换, 期望处数)], 跑哪些文件, 期望红的断言名 or None=不该红)
KNIVES = [
    ('L1', 'par 不再是陪集里的最轻解：minPresses 只认第一个候选',
     [('js/core/gf2.js',
       'if (w < bestWeight || (w === bestWeight && x < best)) {',
       'if (false) {', 1)],
     ['test/gf2-vs-bfs.test.mjs', 'test/library.test.mjs'],
     'full sweep: coset minimum equals BFS distance on all 65536 boards'),

    ('L2', '不可解盘不再给证书（把"我证不了"说成"它无解"）',
     [('js/core/gf2.js',
       'for (const z of coset) if (z && dotGF2(z, board) === 1) return z;',
       'for (const z of coset) if (z && dotGF2(z, board) === 1) return null;', 1)],
     ['test/gf2.test.mjs'],
     'a board nobody can solve is reported as unsolvable, with a checkable certificate'),

    ('L3', '十字邻域少掉自己那一格（关灯规则的核心动作被改坏）',
     [('js/core/grid.js', '  return [j, ...near];', '  return near;', 1)],
     ['test/grid.test.mjs'],
     'the cross neighbourhood is what the rules say it is'),

    ('L4', '评星多给一手（par+1 也算三星）',
     [('js/core/game.js',
       "if (game.presses <= game.par) return { stars: 3, label: '最优熄灯' };",
       "if (game.presses <= game.par + 1) return { stars: 3, label: '最优熄灯' };", 1)],
     ['test/game.test.mjs'],
     '三星的线正落在 par 上：多按一手就退成两星'),

    ('L5', '存档把"最佳按键数"改成留最差那条',
     [('js/core/storage.js',
       'best: !prev || !prev.best || presses < prev.best ? presses : prev.best,',
       'best: !prev || !prev.best || presses > prev.best ? presses : prev.best,', 1)],
     ['test/storage.test.mjs'],
     'best only goes down, perfect is sticky, plays only counts'),

    ('L6', 'hashSeed 退回每字符一轮（教科书 FNV-1a 那一副）',
     [('js/core/rng.js',
       """    h ^= (str.charCodeAt(i) >> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
""", '', 1)],
     ['test/rng.test.mjs', 'test/library.test.mjs'],
     'two rounds per character: a variant, and knowingly not textbook FNV-1a'),

    ('L7', '烘好的关卡数据里把一关的 par 手改大一个',
     [('js/data/lots.js',
       '{"id":"faint-01","tier":"faint","n":4,"board":"171","par":2,',
       '{"id":"faint-01","tier":"faint","n":4,"board":"171","par":3,', 1)],
     ['test/library.test.mjs'],
     'every printed par reproduces from the serialised board'),

    ('L8', '屏幕上那条带比文件里量的宽（带边界被静默合并）',
     [('js/data/lots.js',
       '"key":"dim","label":"昏黄","n":4,"min":4,"max":5',
       '"key":"dim","label":"昏黄","n":4,"min":4,"max":7', 1)],
     ['test/library.test.mjs'],
     'the bands on screen are the bands in the file'),

    ('L9', '每日题不再由日期决定（分享链接会对不上盘）',
     [('js/core/library.js',
       'return list[hashSeed(`${salt}|${seed}`) % list.length];',
       'return list[0];', 1)],
     ['test/library.test.mjs'],
     'a shared pick is the same pick, and it is the pick the URL promises'),

    ('L10', '生成带的窗口放宽到 9（dim 与 shadow 的界就此消失）',
     [('js/core/make.js',
       "{ key: 'dim', label: '昏黄', n: 4, keys: [4, 8], par: [4, 7] },",
       "{ key: 'dim', label: '昏黄', n: 4, keys: [4, 8], par: [4, 9] },", 1)],
     ['test/make.test.mjs'],
     'the ladder is four bands, each with a key dial and a measured par window'),

    ('L11', 'isSolvable 改成"全都能熄"（不可解盘被放行）',
     [('js/core/solve.js',
       'export function isSolvable(board, n) {\n  return getSolver(n).isSolvable(board);',
       'export function isSolvable(board, n) {\n  void board; void n; return true;', 1)],
     ['test/solve.test.mjs'],
     'isSolvable agrees with solve, including on the boards that are not'),

    ('L12', '（不该红）改一盏灯的灯光颜色常量',
     [('css/game.css', '  --lamp: #ffd35c;', '  --lamp: #ffd35d;', 1)],
     EVERYTHING,
     None),

    ('L13', '（不该红）把首页那句存档说明换一个词',
     [('index.html', '存档只写在这台设备的 localStorage 里。', '存档只写在本机的 localStorage 里。', 1)],
     EVERYTHING,
     None),

    # ---- 文档侧：这一档咬的是 tools/doctest.mjs 自己 ----
    ('L14', '文档印的追踪文件数比仓里少一个',
     [('README.md', '`git ls-files | wc -l` = 52', '`git ls-files | wc -l` = 51', 1)],
     [GATE],
     'D10 文档说的追踪文件数等于 git ls-files 现在的数（新增一个文件要一起改文档）'),

    ('L15', '文档分账表把 grid 的 asserts 手抄成一个邻近的数',
     [('README.md', '| `grid` | 11 | 5077 |', '| `grid` | 11 | 5078 |', 1)],
     [GATE],
     'D4 grid 现跑 rows 11 / asserts 5077：文档那两格等于现测'),

    ('L16', '文档把昏黄那条带的实测区间写宽一格',
     [('README.md', '| 昏黄 dim | 4×4 | 8 | 4–5 | 4 | 5–10 | 4–8 |',
       '| 昏黄 dim | 4×4 | 8 | 4–6 | 4 | 5–10 | 4–8 |', 1)],
     [GATE],
     'D2 dim 那一行等于 summaryTable() 的现量（关数 / par / 中位 / 亮格 / 旋钮）'),

    ('L17', '文档的浏览器表少写一条腿（静默少跑一个套件）',
     [('README.md',
       '| `@pointer` | 21 | **真鼠标事件**：坐标取自 `js/view.js` 的 `cellCenter()` 并先平移画布原点，把认证解从头点到熄；全程不叫 `window.lights` 代劳 |\n',
       '', 1)],
     [GATE],
     'D5a 文档浏览器表解析到的腿数等于 verify.sh 默认的腿清单'),

    ('L18', '文档把端口表的 WEB_PORT 抄成另一个数',
     [('README.md', '`WEB_PORT=5190`、`CDP_PORT=9341`', '`WEB_PORT=5191`、`CDP_PORT=9341`', 1)],
     [GATE],
     'D6 文档端口表等于 verify.sh 与 server.cjs 的默认值（换端口要三处一起换）'),

    ('L19', '文档的脚本清单少写一条 script',
     [('README.md', '`start` / `dev`', '`start`', 1)],
     [GATE],
     'D7 文档脚本表覆盖 package.json 的每一条（多一条少一条都红）'),

    ('L20', '文档的秩表把 4×4 的零度抄错（锚点不再是锚点）',
     [('README.md', '| 4×4 | 12 | **4** |', '| 4×4 | 12 | **5** |', 1)],
     [GATE],
     'D1 4×4 秩 12 / 零度 4：文档那行等于锚点也等于现算'),

    ('L21', '文档把一条行号引用指到文件末尾之外',
     [('README.md', 'js/core/game.js:83-88', 'js/core/game.js:8300-8800', 1)],
     [GATE],
     'D9 文档里的每条 path:NN 引用都落在真实文件的行数内（写了行号就得还在文件里）'),

    ('L22', '文档的 CI 覆盖表声称有一条根本不存在的步',
     [('README.md',
       '| `python3 tools/sabotage.py` | unit | `Ledger trips the assertion each knife names` |',
       '| `python3 tools/sabotage.py` | unit | `A step nobody wrote` |', 1)],
     [GATE],
     'D8 python3 tools/sabotage.py 由 unit job 的「A step nobody wrote」这一步真的跑到'),

    # ---- 阴性对照：文档里改了但不当数用的东西，闸不该红 ----
    ('L23', '（不该红）把一个小节标题换一个说法',
     [('README.md', '## 本地运行与脚本清单', '## 本地怎么跑', 1)],
     [GATE],
     None),

    ('L24', '（不该红）在四带表后面补一句解释（表里每个数没动）',
     [('README.md', '| 微光 faint | 4×4 | 8 | 2–3 | 2 | 5–11 | 2–3 |',
       '| 微光 faint | 4×4 | 8 | 2–3 | 2 | 5–11 | 2–3 |\n\n'
       '> 这一句是本轮加的说明，不带任何被钉住的数。', 1)],
     [GATE],
     None),

    ('L25', '（不该红）改一句没人当数用的散文',
     [('README.md', '## 设计细节另见', '## 设计细节在另一份文件里', 1)],
     [GATE],
     None),

    # ---- 接线：砍掉"有人在跑"的任何一处，闸必须当场红，而且红在那条接线断言上 ----
    ('L26', '把 CI 里跑台账的那一步摘掉（台账就此没人跑）',
     [('.github/workflows/ci.yml',
       '      - name: Ledger trips the assertion each knife names\n        run: python3 tools/sabotage.py\n',
       '', 1)],
     [GATE],
     WIRE),

    ('L27', '把 CI 里跑文档闸的那一步摘掉',
     [('.github/workflows/ci.yml',
       '      - name: Documentation figures\n        run: node tools/doctest.mjs\n',
       '', 1)],
     [GATE],
     WIRE),

    ('L28', '把 package.json 里的 sabotage 脚本摘掉（npm run 那条入口没了）',
     [('package.json', ',\n    "sabotage": "python3 tools/sabotage.py"', '', 1)],
     [GATE],
     WIRE),

    ('L29', '把 README 里指着台账的那句删掉（文档不再说有人跑它）',
     # 指认写在好几处：散文里、承诺表、脚本表、CI 覆盖表。只改一处不会让那根线断，
     # 所以这把的期望处数由预检先点一遍数——文档补了句子却没动这里，预检就当场拒绝跑刀。
     [('README.md', 'tools/sabotage.py', 'tools/没有这个文件.py', 7)],
     [GATE],
     WIRE),

    # ---- D13 那一组钉的是"门也在家门口"。这两把刀各回答一个问题：
    # 钉被悄悄改小会不会红（L30）、调用被摘掉会不会红（L31）。
    ('L30', 'verify.sh 的 LOGIC_EXPECTS 把 doctest 那一项钉小 2',
     [('tools/verify.sh', 'LOGIC_EXPECTS="doctest:61 sabotage:32"',
       'LOGIC_EXPECTS="doctest:59 sabotage:32"', 1)],
     [GATE],
     'D13b verify.sh 钉的 doctest 项数等于本闸实跑的项数（增删一条断言要两处一起走）'),

    ('L31', '摘掉 verify.sh 里跑 doctest 的那一行调用（门只在 CI 里跑）',
     [('tools/verify.sh', 'node "$HERE/tools/doctest.mjs" >"$LLOG" 2>&1\n', '', 1)],
     [GATE],
     'D13d 三道逻辑闸在 verify.sh 里各有一条真调用（注释里提到路径不算调用）'),

    # L21 证明越界那一半会红；这一把补的是另一半：行号还在界内、却漂到了隔壁一行。
    # 57 是 `export function applyPress(...)`，58 是它函数体第一行——文件有 62 行以上，
    # 越界检查一条都不会红，只有锚点 `applyPress` 抓得住。
    ('L32', '文档把一条界内的行号引用挪歪一格（只有锚点腿看得见）',
     [('README.md', '`applyPress`（`js/core/grid.js:57`）', '`applyPress`（`js/core/grid.js:58`）', 1)],
     [GATE],
     'D9c 贴着引用的那个名字真的出现在被指的那几行里（行号漂到隔壁一行要红）'),
]


def main():
    snapshot()
    gaps = preflight()
    if gaps:
        print(f'=== 预检：{len(KNIVES)} 把的针，{len(gaps)} 把对不上 ===')
        print('\n'.join(gaps))
        # 这里故意不印 rows/fail：一把刀都没跑，就没有"29 把里几把不符"这个数可报。
        # 这一轮的退出码是 3，不是 1——读的人据此知道红的是台账的针，不是被破坏的代码。
        print('一枪不跑：针数对不上时，前面每一把的红都与这把刀无关。修期望或修文档，别修断言。')
        shutil.rmtree(COPY, ignore_errors=True)
        sys.exit(3)

    # 基线：未破坏的副本必须全绿，否则后面每把刀的"红"都没有意义。
    bad, names, raw = run(EVERYTHING)
    print(f'=== 基线（未破坏）fail={bad}')
    if bad:
        print(raw[-2000:])
        print('基线就有红的套件，台账不成立，先修基线')
        shutil.rmtree(COPY, ignore_errors=True)
        sys.exit(2)

    ledger, thrown = [], 0
    for kid, what, needles, files, want in KNIVES:
        restore()
        try:
            dose(needles)
        except RuntimeError as e:
            thrown += 1
            ledger.append((kid, 'ERROR', str(e), want, False))
            print(f'[ERROR] {kid} {what}\n   needle 打不中：{e}')
            continue
        bad, names, _ = run(files)
        # 点名认的是断言名整行原文：转述也算没点名。
        hit = want is None or any(n == want for n in names)
        ok = bool(bad) and hit if want else bad == 0
        verdict = ('红且点名' if want and bad and hit else
                   '红但没点名' if want and bad else
                   '该红却没红' if want else
                   '不该红·确认没红' if bad == 0 else '不该红却红了')
        ledger.append((kid, verdict, f'fail={bad} 断言={names[:3]}', want, ok))
        print(f'[{verdict}] {kid} {what}')
        print(f'   fail={bad}  红的断言：{names[:3] if names else "（无）"}')
        if want and bad and not hit:
            print('   !! 红了但不是这条：', want)
            print('   !! 实际红在：', names[:5])

    mismatch = sum(1 for row in ledger if row[4] is not True)
    # 副本是自己留下的临时树，绝不能活到下一次读仓：留着它，下一个人分不清哪份是真源。
    shutil.rmtree(COPY, ignore_errors=True)
    print(f'=== 判定 {len(ledger)} 把 / 与预期不符 {mismatch} / 针打不中 {thrown} ===')
    print(f'rows: {len(ledger)} fail: {mismatch}')
    sys.exit(0 if mismatch == 0 else 1)


main()
