// 文档是被断言的面：README 印出去的每一个「现值」都必须等于代码、套件或脚本里的现在值。
//
// 为什么要有这个文件：引擎断言、烘焙数据、秩表都有命令去重测，而一段散文没有。
// 文档可以一直抄下去，直到某天代码改了字、文档还在引用上一个世界的数。本仓 README 里
// 有一整类这样的数——秩表、四带表、包络、套件分账、端口、脚本清单、CI 里到底跑了哪几步、
// 台账有几把刀——每一个都能由一条等式钉住，于是这里钉住它们。
//
// 规矩（和 test/*.test.mjs 一样）：
//   * 每条等式都配一条「解析到的条数」的反空转断言——正则没命中不是绿，是红；
//   * 能现测的就现测：node 层 9 个套件总共 0.4 秒，所以 D4 是真的把它们跑一遍，
//     不是拿文档对文档；
//   * 浏览器层的行数只有真 Chrome 量得到，所以那条等式默认只查名字集合与加总算术，
//     由 `--measured <json>` 提供读数的才是实测比对（tools/verify.sh 跑完会带上）。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { getSolver } from '../js/core/gf2.js';
import { summaryTable } from '../js/core/library.js';
import { TIERS as MAKE_TIERS } from '../js/core/make.js';
import { LOTS, TIERS_META } from '../js/data/lots.js';
import { RANK_TABLE } from '../test/fixture.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const fail = [];
let rows = 0;
const ok = (cond, label, detail) => {
  rows++;
  if (!cond) fail.push(label);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label} · ${detail}`);
};

const README = read('README.md');
const CI = read('.github/workflows/ci.yml');
const VERIFY = read('tools/verify.sh');
const PKG = JSON.parse(read('package.json'));
const SERVER = read('server.cjs');
const SAB = existsSync(join(ROOT, 'tools/sabotage.py')) ? read('tools/sabotage.py') : '';
// 追踪清单只取一次：D9 靠它把 `solve.js:18` 这种省了目录的引用对回真文件，
// D10 用它数仓里有多少文件——两处必须认同一份清单，否则一个漂了另一个还绿。
const LS = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
const TRACKED = (LS.stdout || '').trim().split('\n').filter(Boolean);

// 单元格里的数：先去掉 **加粗** 与反引号，再取最前面那个整数（`**12**（本轮 +1）` → 12）。
const num = (s) => {
  const m = /(\d[\d,]*)/.exec(String(s).replace(/\*\*/g, '').replace(/`/g, '').trim());
  return m ? +m[1].replace(/,/g, '') : null;
};
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
// 一格里允许写 512 或 2^36；两种形式都还原成一个整数再比。
const powerVal = (s) => {
  const t = String(s).replace(/\*\*/g, '').replace(/`/g, '').trim();
  const p = /^2\^(\d+)$/.exec(t);
  if (p) return 2 ** +p[1];
  const n = /^(\d[\d,]*)$/.exec(t);
  return n ? +n[1].replace(/,/g, '') : null;
};

// 按表头定位那张表，返回每个数据行的单元格（表头行与 |---| 分隔行都不算数据）。
// 用表头而不是用正则整行匹配，是因为单元格里允许 `**加粗**`、`（本轮 +1）` 这类注记。
function tableByHeader(header) {
  const lines = README.split('\n');
  const i = lines.findIndex((l) => l.trim() === header);
  if (i < 0) return [];
  const out = [];
  for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j++) out.push(cells(lines[j]));
  return out;
}

const MEASURED_ARG = process.argv.indexOf('--measured');
const MEASURED = MEASURED_ARG >= 0 ? process.argv[MEASURED_ARG + 1] : null;

// ---- D1 秩表：文档那五行 == test/fixture.mjs 写死的锚 == js/core/gf2.js 现算的秩 ----
const rankLines = [...README.matchAll(/^\| (\d)×\d \| \d.*\|$/gm)];
ok(rankLines.length === Object.keys(RANK_TABLE).length,
  'D1a 文档秩表解析到的行数等于 RANK_TABLE 的尺寸数（解析不到不是绿）',
  `解析 ${rankLines.length} 行 vs RANK_TABLE ${Object.keys(RANK_TABLE).length} 个尺寸`);
for (const m of rankLines) {
  const n = +m[1];
  const c = cells(m[0]);
  const anchor = RANK_TABLE[n];
  const s = getSolver(n);
  const rankOk = num(c[1]) === (anchor && anchor.rank) && s.rank === (anchor && anchor.rank);
  const nullOk = num(c[2]) === (anchor && anchor.nullity) && s.nullity === (anchor && anchor.nullity);
  const solvable = powerVal(c[3]);
  const total = powerVal(c[4]);
  const quiet = num(c[6]);
  const ratioOk = s.nullity === 0 ? c[5].includes('全部可解') : c[5].includes(`每 ${2 ** s.nullity} 个盘 1 个可解`);
  ok(rankOk && nullOk && solvable === 2 ** s.rank && total === 2 ** (n * n) && quiet === 2 ** s.nullity && ratioOk,
    `D1 ${n}×${n} 秩 ${s.rank} / 零度 ${s.nullity}：文档那行等于锚点也等于现算`,
    `文档 rank=${c[1]} nullity=${c[2]} 可解=${c[3]} 全盘=${c[4]} quiet=${c[6]} vs ` +
    `锚 ${anchor && anchor.rank}/${anchor && anchor.nullity} 现算 ${s.rank}/${s.nullity} ` +
    `2^rank=${2 ** s.rank} 2^(n²)=${2 ** (n * n)}`);
}

// ---- D2 四带表：文档那张表 == library.summaryTable() 从磁盘 32 行现量的 ----
const bandLines = [...README.matchAll(/^\| (微光|昏黄|暗影|全熄) (\w+) \| (\d)×(\d) \| (\d+) \| (\d+)–(\d+) \| (\d+) \| (\d+)–(\d+) \| (\d+)–(\d+) \|$/gm)];
const summary = summaryTable();
ok(bandLines.length === summary.length,
  'D2a 文档四带表解析到的行数等于 summaryTable() 的档数',
  `解析 ${bandLines.length} 行 vs 现量 ${summary.length} 档`);
for (const m of bandLines) {
  const t = summary.find((r) => r.tier === m[2]);
  const same = !!t && t.label === m[1] && t.board === `${m[3]}x${m[4]}` && +m[5] === t.lots &&
    `${m[6]}–${m[7]}` === t.par.replace('-', '–') && +m[8] === t.parMed &&
    `${m[9]}–${m[10]}` === t.lit.replace('-', '–') && `${m[11]}–${m[12]}` === t.dial.replace('-', '–');
  ok(same, `D2 ${m[2]} 那一行等于 summaryTable() 的现量（关数 / par / 中位 / 亮格 / 旋钮）`,
    t ? `文档 ${m[5]} 关/${m[6]}–${m[7]}/中位 ${m[8]}/亮 ${m[9]}–${m[10]}/旋钮 ${m[11]}–${m[12]} ` +
        `vs 现量 ${t.lots} 关/${t.par}/中位 ${t.parMed}/亮 ${t.lit}/旋钮 ${t.dial}`
      : 'summaryTable() 里没有这一档');
}

// ---- D3 包络与实测并排存着：文档写的窗口 == make.js 的窗口，文档写的落点 == 32 行现量 ----
const envelope = [...README.matchAll(/\b(faint|dim|shadow|blackout) (\d+)–(\d+)/g)];
ok(envelope.length === MAKE_TIERS.length,
  'D3a 文档的包络句解析到四档窗口（少一档就是那句话被改写了）',
  `解析 ${envelope.length} 处 vs make.js ${MAKE_TIERS.length} 档`);
const measuredByTier = {};
for (const row of LOTS) {
  const m = measuredByTier[row.tier] || (measuredByTier[row.tier] = { min: Infinity, max: -Infinity });
  m.min = Math.min(m.min, row.par);
  m.max = Math.max(m.max, row.par);
}
for (const m of envelope) {
  const t = MAKE_TIERS.find((x) => x.key === m[1]);
  ok(!!t && t.par[0] === +m[2] && t.par[1] === +m[3],
    `D3 ${m[1]} 包络 ${m[2]}–${m[3]} 等于 make.js 的窗口`,
    t ? `文档 ${m[2]}–${m[3]} vs make.js ${t.par[0]}–${t.par[1]}` : 'make.js 里没有这一档');
}
const metaOk = TIERS_META.every((t) => t.min === measuredByTier[t.key].min && t.max === measuredByTier[t.key].max);
const docLanding = [...README.matchAll(/(dim|blackout) 的?包络是? (\d+)–(\d+)，(?:8 关)?(?:实际只)?落在 (\d+)–(\d+)/g)];
ok(metaOk && docLanding.length === 2,
  'D3b 文档写的落点等于 lots.js 的 TIERS_META，也等于 32 行现算的 min/max',
  `TIERS_META ${TIERS_META.map((t) => `${t.key} ${t.min}–${t.max}`).join(' / ')} · 现算 ` +
  `${Object.entries(measuredByTier).map(([k, v]) => `${k} ${v.min}–${v.max}`).join(' / ')} · 文档落点句 ${docLanding.length} 条`);

// ---- D4 node 层分账：现跑 9 个套件，文档印的 rows/asserts 逐格对账 ----
const ledgerCells = {};
for (const c of tableByHeader('| 套件 | rows | asserts | 套件 | rows | asserts |')) {
  const pairs = [[c[0], c[1], c[2]], [c[3], c[4], c[5]]];
  for (const [rawName, r, a] of pairs) {
    const name = rawName.replace(/\*\*/g, '').replace(/`/g, '');
    if (name === '加总') ledgerCells.__total = { rows: num(r), asserts: num(a) };
    else ledgerCells[name] = { rows: num(r), asserts: num(a) };
  }
}
const suiteNames = (() => {
  const names = readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.test.mjs')).sort();
  return names.map((f) => f.replace(/\.test\.mjs$/, ''));
})();
ok(Object.keys(ledgerCells).filter((k) => k !== '__total').length === suiteNames.length,
  'D4a 文档分账表解析到的套数等于 test/*.test.mjs 的文件数（少一个文件就是静默少跑）',
  `解析 ${Object.keys(ledgerCells).filter((k) => k !== '__total').length} 套 vs 磁盘 ${suiteNames.length} 个套件（${suiteNames.join(' ')}）`);
const live = {};
for (const name of suiteNames) {
  const r = spawnSync('node', [`test/${name}.test.mjs`], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const a = /asserts: (\d+)/.exec(out);
  const rw = /rows: (\d+) fail: (\d+)/.exec(out);
  live[name] = { rows: rw ? +rw[1] : null, asserts: a ? +a[1] : null, bad: rw ? +rw[2] : null, rc: r.status };
  const doc = ledgerCells[name] || {};
  ok(doc.rows === live[name].rows && doc.asserts === live[name].asserts && live[name].bad === 0,
    `D4 ${name} 现跑 rows ${live[name].rows} / asserts ${live[name].asserts}：文档那两格等于现测`,
    `文档 ${doc.rows}/${doc.asserts} vs 现跑 ${live[name].rows}/${live[name].asserts}（fail ${live[name].bad}、rc ${live[name].rc}）`);
}
const sumRows = suiteNames.reduce((s, n) => s + (live[n].rows || 0), 0);
const sumAsserts = suiteNames.reduce((s, n) => s + (live[n].asserts || 0), 0);
const docTotals = [...README.matchAll(/`rows: (\d+) \/ asserts: (\d+) \/ fail: (\d+)`/g)];
ok(!!ledgerCells.__total && ledgerCells.__total.rows === sumRows && ledgerCells.__total.asserts === sumAsserts &&
    docTotals.length >= 2 && docTotals.every((d) => +d[1] === sumRows && +d[2] === sumAsserts && +d[3] === 0),
  'D4b 文档印的加总等于九套现跑之和（表里、承诺表、门禁清单说的是同一个数）',
  `现跑合计 rows ${sumRows} / asserts ${sumAsserts} · 表内加总 ${ledgerCells.__total && ledgerCells.__total.rows}/` +
  `${ledgerCells.__total && ledgerCells.__total.asserts} · 文档另有 ${docTotals.length} 处印「rows / asserts / fail」`);

// ---- D5 浏览器层：套件名 == verify.sh 的默认清单；每档行数由 --measured 现比 ----
const legs = (/\bfor s in \$\{SCENARIOS:-([^}]*)\}/.exec(VERIFY) || [])[1];
const legNames = (legs || '').trim().split(/\s+/).filter(Boolean);
const browserLines = [...README.matchAll(/^\| `@(\w+)` \| (\d+) \| /gm)];
ok(browserLines.length === legNames.length && legNames.length === 5,
  'D5a 文档浏览器表解析到的腿数等于 verify.sh 默认的腿清单',
  `解析 ${browserLines.length} 行 vs verify.sh ${legNames.length} 腿（${legNames.map((l) => '@' + l).join(' ')}）`);
const legSetDoc = browserLines.map((m) => m[1]).sort().join(',');
ok(legSetDoc === [...legNames].sort().join(','),
  'D5b 文档列的腿名与 verify.sh 跑的腿名一模一样（改名要两边一起改）',
  `文档 ${legSetDoc} vs 脚本 ${[...legNames].sort().join(',')}`);
const sumLine = /(\d+(?: \+ \d+){3,}) = (\d+)/.exec(README);
const parts = sumLine ? sumLine[1].split(' + ').map(Number) : [];
ok(!!sumLine && parts.reduce((a, b) => a + b, 0) === +sumLine[2],
  'D5c 文档那条加总算式自己算得对（写歪一次就红一次）',
  sumLine ? `${sumLine[1]} = ${sumLine[2]}（左边相加 ${parts.reduce((a, b) => a + b, 0)}）` : '文档里找不到浏览器层的加总算式');
if (MEASURED) {
  let measured = null;
  try { measured = JSON.parse(readFileSync(join(ROOT, MEASURED), 'utf8')); } catch (e) { measured = null; }
  const got = measured && Object.keys(measured);
  ok(!!measured && got.length === legNames.length,
    'D5d --measured 带回来的读数正好覆盖每条腿（少一条就是拿旧档蒙这一关）',
    `读到 ${got ? got.join(' ') : '（文件不存在或不是 JSON）'} vs 腿 ${legNames.join(' ')}`);
  for (const m of browserLines) {
    const val = measured ? measured[`@${m[1]}`] : null;
    ok(val === +m[2], `D5 ${m[1]} 浏览器行数文档 ${m[2]} == 真 Chrome 量到的 ${val}`,
      `文档 ${m[2]} vs 实测 ${val}`);
  }
}

// ---- D6 端口与 URL 形态：文档写的就是脚本与 server 里的默认值 ----
const webDoc = /\| 手工试玩 \| `http:\/\/127\.0\.0\.1:(\d+)\/`/.exec(README);
const cdpDoc = /`WEB_PORT=(\d+)`、`CDP_PORT=(\d+)`/.exec(README);
const webScript = /WEB_PORT:-(\d+)/.exec(VERIFY);
const cdpScript = /CDP_PORT:-(\d+)/.exec(VERIFY);
const serverDefault = /port = (\d+), root = __dirname/.exec(SERVER) || /argv\[2\]\) \|\| Number\(process\.env\.PORT\) \|\| (\d+)/.exec(SERVER);
const urlDoc = /https:\/\/z-biz-game\.github\.io\/([\w-]+)\//.exec(README);
ok(!!webDoc && !!cdpDoc && webDoc[1] === webScript[1] && cdpDoc[2] === cdpScript[1] &&
    webDoc[1] === serverDefault[1] && cdpDoc[1] === webScript[1],
  'D6 文档端口表等于 verify.sh 与 server.cjs 的默认值（换端口要三处一起换）',
  `文档 web=${webDoc && webDoc[1]} ${cdpDoc && cdpDoc[1]}/${cdpDoc && cdpDoc[2]} vs 脚本 web=${webScript && webScript[1]} cdp=${cdpScript && cdpScript[1]} server=${serverDefault && serverDefault[1]}`);
ok(!!urlDoc && urlDoc[1] === basename(ROOT),
  'D6b 文档写的线上前缀等于仓名（Pages 带仓名前缀，相对路径才成立）',
  `文档 ${urlDoc && urlDoc[1]} vs 目录 ${basename(ROOT)}`);

// ---- D7 脚本清单：文档那张表里的 script 名 == package.json 的键 ----
// 名字里允许 . 和 -：npm 的合法 script 名就带这两个字符（deploy-set:selftest），
// 只写 [\w:] 会让带连字符的行在文档里数不出来，于是「文档覆盖每一条 script」这条钉对新加的
// 那条命令永远红——覆盖要求一条没松，只是名册以前抄窄了。
const scriptRows = tableByHeader('| script | 命令 | 本轮状态 |');
const docScripts = [...new Set(scriptRows.flatMap((c) => [...c[0].matchAll(/`([\w:.-]+)`/g)].map((x) => x[1])))];
const realScripts = Object.keys(PKG.scripts);
// 允许一行写两条（`\`start\` / \`dev\``），但合并数要当场数出来，不许拿"行对不上"当借口。
const merged = scriptRows.filter((c) => [...c[0].matchAll(/`([\w:.-]+)`/g)].length > 1).length;
ok(scriptRows.length > 0 && scriptRows.length + merged === realScripts.length &&
    docScripts.sort().join(',') === [...realScripts].sort().join(','),
  'D7 文档脚本表覆盖 package.json 的每一条（多一条少一条都红）',
  `文档 ${docScripts.join(' ')}（${scriptRows.length} 行，其中 ${merged} 行合并了两条）vs package.json ${realScripts.join(' ')}`);

// ---- D8 CI 覆盖表：文档说「这条命令由 CI 的哪一步跑」，那一步就得真在那个工作流里 ----
const ciRows = [...README.matchAll(/^\| `(python3 tools\/sabotage\.py|node tools\/doctest\.mjs|bash tools\/verify\.sh|npm run unit|npm run check)` \| (unit|browser) \| `([^`]+)` \|$/gm)];
const jobBlocks = {};
{
  const lines = CI.split('\n');
  let current = null;
  for (const line of lines) {
    const start = /^  (\w+):/.exec(line);
    if (start) { jobBlocks[start[1]] = ''; current = start[1]; continue; }
    if (current) jobBlocks[current] += line + '\n';
  }
  for (const k of Object.keys(jobBlocks)) if (!jobBlocks[k].includes('steps:')) delete jobBlocks[k];
}
ok(Object.keys(jobBlocks).length >= 2, 'D8a 工作流里解析到了 job（解析不到就别充绿）',
  `解析到 ${Object.keys(jobBlocks).join(' ')}`);
ok(ciRows.length >= 4, 'D8b 文档的 CI 覆盖表解析到了至少四行',
  `解析 ${ciRows.length} 行`);
for (const m of ciRows) {
  const block = jobBlocks[m[2]] || '';
  const tail = m[1].split(' ').slice(-2).join(' ');
  ok(block.includes(`name: ${m[3]}`) && block.includes(m[1]),
    `D8 ${m[1]} 由 ${m[2]} job 的「${m[3]}」这一步真的跑到`,
    block.includes(`name: ${m[3]}`) ? (block.includes(m[1]) ? '步名与命令都在' : '步名在，命令不是这条') : '工作流里没有这一步');
}

// ---- D9 行号引用：写了行号就得还在文件里，而且贴着引用的那个名字得真在被指的那几行上 ----
// 越界检查抓不住"漂到隔壁一行"：本轮清出来的两条（`server.cjs:48` 上是 `port = 5190` 而不是 `PORT`、
// `js/main.js:33-42` 里根本没有 `press`）都稳稳落在界内，界内检查一条都不会红。
// 锚点规则与 fleet（ferry / tatamibari / echo-location / creek）同一份，五种贴法都认：
// `name`（`path:NN`）、`path:NN`（`name`）、`path:NN` 的 `name`、`path:NN`（`fn(a, b)`）、
// `path:NN`（`dir/file.js::symbol`）。`::` 取段排在 `/` 判据之前（否则带目录限定的符号名被当成路径而丢掉锚点）；
// 带 `<占位>` 的模板 body 取字面量前缀；带空格的 body 是命令行，硬按首词钉就是一次假红；
// 纯标点（`，`、`、`）隔开的那个名字只是列表的上一项，不构成指认。
// 输入集从目录现数：老写法只读 README+DESIGN，deliverable.md 那 13 条引用一直没人看，
// 而闸照样打印"全部在范围内"——手抄的名单会让这条腿自己缩样。
// 除 `path:NN` 之外还认**续引**（完整引用后面只写行号）：它只向同一句里最近的那条完整引用借出处，
// 句号/分号/空行/新标题都截断这次借；借不到出处的一条也不静默跳过，而是计入页面上那个「无法定址」。
{
  const docFiles = readdirSync(ROOT).filter((f) => f.endsWith('.md'));
  ok(docFiles.length >= 3, 'D9a 本仓根下有三份以上的文档可审（闸的输入集不许自己空掉）', docFiles.join(','));
  let docText = '';
  for (const f of docFiles) docText += read(f) + '\n';

  const PATH_SRC = '[\\w./-]+?\\.(?:js|mjs|cjs|sh|json|yml|html|css)';
  const CITE = new RegExp('^(' + PATH_SRC + '):([0-9]+(?:[,-][0-9]+)*)$');
  // 续引：完整引用后面只写行号——`js/core/grid.js:57`（`applyPress`）之后再写 `:61`。本仓三份文档里
  // 这种写法不少（条数由 D9k/D9l 两行现数并钉住，所以这条注释里不写数），而这条腿以前只认 `path:NN`，
  // 于是它报"全部在范围内"时其实只看了文档的一部分。
  // 借规则：只向**同一句里最近的那条完整引用**借出处；句号、空行、新标题都截断这次借。
  // 正文里提到一个文件名不构成出处：宁可计入「无法定址」，也不要在错的文件上判绿（判绿比判红糟）。
  const BARE = /^:([0-9]+(?:[,-][0-9]+)*)$/;
  const STOP = /[。！？；]/;
  const inheritedPath = (text, spans, i) => {
    for (let j = i - 1; j >= 0; j--) {
      const pc = spans[j].body.match(CITE);
      if (!pc) continue;
      const between = text.slice(spans[j].end, spans[i].s);
      if (between.includes('\n') && (STOP.test(between) || /\n[ \t]*\n/.test(between) || /\n#{1,6} /.test(between))) return null;
      return { path: pc[1] };
    }
    return null;
  };
  // 锚点可以是成员路径（`view.cellCenter`），但不许是文件路径：body 里带 `/` 的那一类是另一条引用。
  const ID = /^[A-Za-z_$][A-Za-z0-9_$]{2,}(?:\.[A-Za-z_$][A-Za-z0-9_$]+)*$/;
  const tokOf = (body) => {
    const seg = body.includes('::') ? body.slice(body.lastIndexOf('::') + 2) : body;
    if (seg.includes('/')) return '';
    // 只有真写了占位符才这么拆，否则 `deploy-set:selftest` 这种脚本名会被拆成 `deploy`。
    const tpl = /^([^<>]+?)<[^<>\s]+>/.exec(seg);
    if (tpl && ID.test(tpl[1].split(':')[0].trim())) return tpl[1].split(':')[0].trim();
    const head = seg.split('(')[0].trim();
    if (ID.test(head)) return head;
    const lhs = head.split(/[=:]\s/)[0].trim();
    return ID.test(lhs) ? lhs : '';
  };
  // 文档里也有只写文件名的引用（`solve.js:18`）：按 git 追踪清单找唯一同名文件，多处同名不算指到实处。
  function resolvePath(p) {
    if (existsSync(join(ROOT, p))) return p;
    const hits = TRACKED.filter((t) => t === p || t.endsWith('/' + p));
    return hits.length === 1 ? hits[0] : null;
  }
  const lineCache = new Map();
  const linesOf = (p) => {
    if (!lineCache.has(p)) {
      const rel = resolvePath(p);
      let arr = null;
      if (rel) {
        arr = read(rel).split('\n');
        if (arr[arr.length - 1] === '') arr.pop();
      }
      lineCache.set(p, arr);
    }
    return lineCache.get(p);
  };
  function parseRefs(text, orphans = null) {
    const spans = [];
    const spanRe = /`([^`\n]+)`/g;
    let m;
    while ((m = spanRe.exec(text))) spans.push({ body: m[1], s: m.index, end: m.index + m[0].length });
    const out = [];
    for (let i = 0; i < spans.length; i++) {
      const c = spans[i].body.match(CITE);
      const bare = c ? null : BARE.exec(spans[i].body);
      if (!c && !bare) continue;
      const owner = c ? { path: c[1] } : inheritedPath(text, spans, i);
      if (!owner) { if (orphans) orphans.push(bare[0]); continue; }
      let anchor = '';
      let consumed = false;
      const next = spans[i + 1];
      const gA = next ? text.slice(spans[i].end, next.s) : null;
      if (gA !== null && gA.length <= 4 && !gA.includes('\n')) {
        const gN = gA.replace(/\s+/g, '');
        if (/^[（(]/.test(gN) || gN === '的') { consumed = true; anchor = tokOf(next.body); }
      }
      // 前向没认出注解形状时才接着试后向；用 `else if` 挂在前向条件上，
      // 「`NAME` 在 `path:NN`、」这种后面紧跟短间隔的写法就把后向那把弄哑了。
      if (!consumed && i > 0) {
        const prev = spans[i - 1];
        const gap = text.slice(prev.end, spans[i].s);
        const gT = gap.replace(/\s+/g, '');
        const shaped = /^[（(]/.test(gT) || /[\w一-鿿]/.test(gT);
        if (shaped && !/\s/.test(prev.body) && gap.length <= 4 && !gap.includes('\n')) anchor = tokOf(prev.body);
      }
      // 续引只借路径——它自己印的那些数字才是文档的主张。
      const range = c ? c[2] : bare[1];
      for (const seg of range.split(',')) {
        const parts = seg.split('-').map(Number);
        out.push({ path: owner.path, from: parts[0], to: parts[parts.length - 1] || parts[0], anchor, cont: !c });
      }
    }
    return out;
  }
  const audit = (text) => {
    const orphans = [];
    const refs = parseRefs(text, orphans);
    const outOfRange = [];
    const anchorBad = [];
    for (const r of refs) {
      const label = `${r.path}:${r.from}${r.to !== r.from ? '-' + r.to : ''}`;
      const lines = linesOf(r.path);
      if (!lines) { outOfRange.push(`${label} 文件不存在（同名文件不唯一时也不算指到实处）`); continue; }
      if (r.from < 1 || r.to > lines.length) {
        outOfRange.push(`${label}（该文件只有 ${lines.length} 行）`);
        continue;
      }
      if (r.anchor && !lines.slice(r.from - 1, r.to).join('\n').includes(r.anchor)) {
        anchorBad.push(`${label} 那几行里没有 ${r.anchor}`);
      }
    }
    // `` `文件`（N 行）`` 这种实测值按等式收：写歪一格、文件不在，都算指不回实处。
    const cntRe = new RegExp('`(' + PATH_SRC + ')`（([0-9]+) 行）', 'g');
    let k;
    while ((k = cntRe.exec(text))) {
      const lines = linesOf(k[1]);
      if (!lines) outOfRange.push(`${k[1]}（${k[2]} 行）文件不存在`);
      else if (lines.length !== +k[2]) outOfRange.push(`${k[1]} 实测 ${lines.length} 行，文档写的是 ${k[2]}`);
    }
    return { refs, outOfRange, anchorBad, unaddressed: orphans.length };
  }
  const A = audit(docText);
  const anchored = A.refs.filter((r) => r.anchor).length;

  ok(A.refs.length >= 40, 'D9b 这条腿读到的引用数多到它自己算覆盖面（少于 40 条就是输入集缩了）', `本次解析 ${A.refs.length} 条`);
  ok(A.outOfRange.length === 0, 'D9 文档里的每条 path:NN 引用都落在真实文件的行数内（写了行号就得还在文件里）',
    A.outOfRange.length ? `越界或不存在：${A.outOfRange.join('，')}` : `${A.refs.length} 条全部在范围内`);
  ok(A.anchorBad.length === 0, 'D9c 贴着引用的那个名字真的出现在被指的那几行里（行号漂到隔壁一行要红）',
    A.anchorBad.length ? `锚点漂 ${A.anchorBad.length} 处：${A.anchorBad.join(' | ')}` : `${anchored} 条带锚点的引用全部落回原处`);
  // 锚点腿自己的覆盖面：指认条数太少说明规则被写窄（或文档被改写），那时上一条的"绿"是空转。
  ok(anchored >= 8, 'D9d 文档里确实有足够多的引用带指认（少于 8 条就是锚点腿空转）', `本次认到锚点的 ${anchored} 条`);

  // 等式闸：文档转写的「解析 N 条」必须等于这条腿自己数到的，且文档确实写了它——删掉数字同样算红。
  {
    const claims = [...docText.matchAll(/解析 (\d+) 条/g)].map((x) => +x[1]);
    ok(claims.length >= 1 && claims.every((c) => c === A.refs.length),
      'D9e 文档里每一处「解析 N 条」都等于这条腿自己数到的（删掉这个数字同样算红）',
      `闸数到 ${A.refs.length} · 文档写了 ${claims.length} 处：${[...new Set(claims)].join('/') || '（一处都没写）'}`);
  }

  // 「认到锚点 N 条」同样是印在页面上的现值：续引会带来新的锚点，这个数一漂就得红。
  {
    const aClaims = [...docText.matchAll(/认到锚点 (\d+) 条/g)].map((x) => +x[1]);
    ok(aClaims.length >= 1 && aClaims.every((c) => c === anchored),
      'D9t 文档里每一处「认到锚点 N 条」都等于这条腿自己数到的（删掉这个数字同样算红）',
      `闸数到 ${anchored} · 文档写了 ${aClaims.length} 处：${[...new Set(aClaims)].join('/') || '（一处都没写）'}`);
  }

  // 续引在这三份文档里到底借到了没有：一条也没有就是这条规则在自己仓里空转。
  const contRefs = A.refs.filter((r) => r.cont).length;
  ok(contRefs >= 1 && contRefs < A.refs.length, 'D9k 三份文档里确有续引在同句内借到了出处（一条也没有就是这条规则空转）',
    `解析 ${A.refs.length} 条 · 其中续引借到出处 ${contRefs} 条`);
  // 借不到的不当错误、也不静默跳过：数出来写进页面，再由这一条钉住——新增一条定不了址的引用会把闸打红，
  // 而不是让覆盖面悄悄缩水。
  {
    const gapClaims = [...docText.matchAll(/无法定址 (\d+) 处/g)].map((x) => +x[1]);
    ok(gapClaims.length >= 1 && gapClaims.every((c) => c === A.unaddressed),
      'D9l 文档里每一处「无法定址 N 处」都等于这条腿数到的借不到出处的续引（删掉这个数字同样算红）',
      `闸数到 ${A.unaddressed} · 文档写了 ${gapClaims.length} 处：${[...new Set(gapClaims)].join('/') || '（一处都没写）'}`);
  }

  // 续引的七把控制腿，全在内存里、一个字不碰盘上的文档：借到 / 句尾墙 / 软换行仍算同一句 /
  // 空行与新标题截断 / 借来的路径喂进边界检查 / 正文里提到的文件名不是出处 / 同一句改写成完整引用就读得回来。
  const cG = audit('`js/core/grid.js:57`（`applyPress`）、`applyPattern`（`:62`）');
  ok(cG.refs.length === 2 &&
    cG.refs.filter((r) => r.cont).length === 1 && cG.unaddressed === 0 &&
    cG.outOfRange.length === 0 && cG.anchorBad.length === 0 &&
    cG.refs.every((r) => r.path === 'js/core/grid.js'),
    'D9m 续引在同句内借到出处，并带上自己那一格的指认',
    `refs=${cG.refs.length} 红=${[...cG.outOfRange, ...cG.anchorBad].join(' | ') || '无'} 借不到=${cG.unaddressed}`);
  const cW = audit('`js/core/grid.js:57`（`applyPress`）。\n`applyPattern`（`:62`）');
  ok(cW.refs.length === 1 && cW.unaddressed === 1, 'D9n 句号把借的窗口关上：下一句的续引不许挂到上一句的出处上',
    `refs=${cW.refs.length} 借不到=${cW.unaddressed}`);
  const cP = audit('`js/core/grid.js:57`（`applyPress`）、\n`applyPattern`（`:62`）');
  ok(cP.refs.length === 2 && cP.unaddressed === 0, 'D9o 软换行不算换句：同一句折行后续引照样借得到',
    `refs=${cP.refs.length} 借不到=${cP.unaddressed}`);
  const cH = audit('`js/core/grid.js:57`（`applyPress`）\n\n## 续\n`applyPattern`（`:62`）');
  ok(cH.refs.length === 1 && cH.unaddressed === 1, 'D9p 空行与新标题同样截断这次借',
    `refs=${cH.refs.length} 借不到=${cH.unaddressed}`);
  const cB = audit('`js/core/grid.js:57`（`applyPress`）、`applyPattern`（`:99999`）');
  ok(cB.outOfRange.length === 1 && cB.outOfRange[0].includes('js/core/grid.js'),
    'D9q 借来的路径喂进边界检查：续引写一个越界的行号必须红，并点名被借的那个文件',
    cB.outOfRange.join(' | ') || '（没红）');
  const cF = audit('这一族全在 `gf2.js` 里，`getSolver`（`:53`）');
  ok(cF.refs.length === 0 && cF.unaddressed === 1,
    'D9r 正文里提到的文件名不是出处：这种写法必须算借不到，而不是在错的文件上判绿',
    `refs=${cF.refs.length} 借不到=${cF.unaddressed}`);
  const cC = audit('这一族全在 `gf2.js` 里，`getSolver`（`js/core/gf2.js:53`）');
  ok(cC.refs.length === 1 && cC.unaddressed === 0 && cC.anchorBad.length === 0,
    'D9s 同一句改写成完整引用就读得回来：D9r 红的是写法，不是解析器漏了这一句',
    `refs=${cC.refs.length} 借不到=${cC.unaddressed} 红=${cC.anchorBad.join(' | ') || '无'}`);

  // 反空转：七把假引用必须一把不落——文件不存在、行号越界、四种写法各自的锚点漂、行数写错。
  const F = audit('出处 `js/core/nope.js:1`、`server.cjs:99999`、`NO_SUCH_ANCHOR` 在 `server.cjs:48`、' +
    '`package.json`（999 行）、`server.cjs:48`（`PORT`）、`server.cjs:48` 的 `PORT`、' +
    '`js/core/grid.js:57`（`Math.max(3, 4)`）');
  ok(F.outOfRange.length + F.anchorBad.length === 7,
    'D9f 假引用七把全被抓到（不存在 / 越界 / 后向锚点漂 / 行数错 / 前向括号锚点漂 / 「的」锚点漂 / 函数调用形式锚点漂）',
    [...F.outOfRange, ...F.anchorBad].join(' | '));

  // 阳性对照：五种真注解写法 + 真行数必须判绿，否则上一条的"红"可能只是解析器自己坏了。
  // 带空格的命令行 body（`npm run doctest`）也在这一组里：它"不该生成锚点"，
  // 老写法按首词切会拿 `npm` 去钉，在自己造的那一行上红。
  const pkgLines = linesOf('package.json');
  const fwd = audit('`applyPress`（`js/core/grid.js:57`）、`js/core/grid.js:57`（`applyPress`）、' +
    '`js/core/grid.js:57` 的 `applyPress`、`js/core/gf2.js:53`（`js/core/gf2.js::getSolver`）、' +
    '`js/core/grid.js:57`（`applyPress(board, n, j)`）、`js/core/grid.js:57`（`npm run doctest`） 与 ' +
    '`package.json`（' + (pkgLines ? pkgLines.length : 0) + ' 行）');
  ok(fwd.anchorBad.length === 0 && fwd.outOfRange.length === 0 && fwd.refs.length === 6,
    'D9g 后向、前向括号、「的」、`path::symbol`、函数调用五种真注解加带空格的命令行 body，都在同一个解析器下判绿',
    [...fwd.outOfRange, ...fwd.anchorBad].join(' | ') + `（refs=${fwd.refs.length}）`);
  // 模板前缀：`name:<占位>` 指的是那串字面量前缀。本仓文档没这么写过，所以这一把只由台架证明；
  // 规则一丢，`NOPE:<占位>` 那种假引用连锚点都不会生成，七把里就少一把。
  const tplGreen = audit('`js/core/grid.js:57`（`applyPress:<占位>`）');
  const tplRed = audit('`js/core/grid.js:57`（`NOPE:<占位>`）').anchorBad;
  ok(tplGreen.anchorBad.length === 0 && tplGreen.refs.length === 1 && tplRed.length === 1,
    'D9h 模板 body 取字面量前缀：前缀对得上判绿、对不上必须红（规则一丢这一把就哑）',
    `绿=${tplGreen.anchorBad.length ? tplGreen.anchorBad.join(' | ') : 'ok'} · 红在 ${tplRed.join(' | ') || '（一处都没红）'}`);
  // 反方向的控制：逗号不是指认。前面那个名字只是列表的上一项，按它钉会把正确的文档读红。
  const comma = audit('`NO_SUCH_ANCHOR`，`js/core/grid.js:57`');
  ok(comma.anchorBad.length === 0 && comma.refs.length === 1,
    'D9i 纯标点间隔（`，`）不构成指认：这种写法必须判绿',
    comma.anchorBad.join(' | ') + `（refs=${comma.refs.length}）`);

  // 这条腿对本仓文档真有牙齿：把一条界内的真引用挪歪一格，只有锚点抓得住。
  // 改的是内存里的副本，盘上的文档一个字不动。
  {
    const needle = '`applyPress`（`js/core/grid.js:57`）';
    const hits = docText.split(needle).length - 1;
    const p = audit(docText.replace(needle, '`applyPress`（`js/core/grid.js:58`）'));
    ok(hits === 1 && p.anchorBad.length === 1,
      'D9j 把文档里一条真引用的行号挪歪一格，这条腿必须为它变红',
      `needle 命中 ${hits} 处 · 红在 ${[...p.outOfRange, ...p.anchorBad].join(' | ') || '（一处都没红）'}`);
  }
}

// ---- D10 追踪文件数：文档印的 `git ls-files | wc -l` 等于现在的仓 ----
const trackedCount = TRACKED.length;
const docTracked = /`git ls-files \| wc -l` = (\d+)/.exec(README);
ok(LS.status === 0 && trackedCount > 0 && !!docTracked && +docTracked[1] === trackedCount,
  'D10 文档说的追踪文件数等于 git ls-files 现在的数（新增一个文件要一起改文档）',
  `文档 ${docTracked && docTracked[1]} vs git ${trackedCount}（rc=${LS.status}）`);

// ---- D11 台账刀数：文档那张逐枪表的行号集合 == tools/sabotage.py 的 KNIVES ----
// 散文里那句"共 N 把"也一起比：只补表不改散文（或反过来）都是一半人在说另一半没说的话。
const docKnives = [...README.matchAll(/^\| (L\d+) \| /gm)].map((m) => m[1]);
const rigKnives = [...SAB.matchAll(/^\s{4}\('(L\d+)'/gm)].map((m) => m[1]);
const proseKnives = [...new Set([...README.matchAll(/共 \*\*(\d+) 把\*\*/g)].map((m) => m[1]))];
ok(docKnives.length > 0 && rigKnives.length > 0,
  'D11a 台账两边都解析到了刀号（解析不到就别充绿）',
  `文档 ${docKnives.length} 行、台架 ${rigKnives.length} 把${SAB ? '' : '（台架文件不在树里）'}`);
ok(docKnives.join(',') === rigKnives.join(',') && proseKnives.length === 1
  && +proseKnives[0] === rigKnives.length,
  'D11 文档逐枪表的每一把刀都在台架里，台架的每一把都写进了文档，散文那句"共 N 把"是同一个数',
  `文档 ${docKnives.join(' ')} vs 台架 ${rigKnives.join(' ')} · 散文 ${proseKnives.join('/') || '没解析到'}`);

// ---- D12 接线：台账被 CI、package.json、README 指着，而且这条接线自己有一把刀 ----
const sabWires = {
  ci: /run: python3 tools\/sabotage\.py/.test(CI),
  pkg: ((PKG.scripts || {}).sabotage || '').trim() === 'python3 tools/sabotage.py',
  readme: /python3 tools\/sabotage\.py/.test(README),
  knife: /'D12/.test(SAB),
  doctest_ci: /run: node tools\/doctest\.mjs/.test(CI),
  doctest_pkg: ((PKG.scripts || {}).doctest || '').trim() === 'node tools/doctest.mjs',
  doctest_readme: /node tools\/doctest\.mjs/.test(README),
};
ok(Object.values(sabWires).every(Boolean),
  'D12 台账与文档闸都接进了 CI 和 package.json，而且接线自己有一把刀（砍掉任何一处它就只是一段代码）',
  Object.entries(sabWires).map(([k, v]) => `${k}=${v ? '在' : '缺'}`).join(' · ') + (SAB ? '' : ' · 台架文件不在树里'));

// ---- D13 家门口的门：verify.sh 必须跑这三道逻辑闸，而且钉的条数与实跑一致 ----
// 补的是「门只在 CI 里跑」这个缺陷：CI 的 unit job 有 node 套件、文档闸、台账三步，
// 而本地那道 one-shot 以前一步都不跑——改闸的人在自己机器上看见的绿，是另一套。
// 先数解析到几颗钉：读不到那一行时，后面三条都会变成"什么都不比较"的空转绿。
const pinBlock = (VERIFY.match(/^\s*LOGIC_EXPECTS="([^"]+)"/m) || [])[1] || '';
const pins = Object.fromEntries(pinBlock.split(/\s+/).filter(Boolean).map((kv) => kv.split(':')));
ok(Object.keys(pins).length === 2 && !!pins.doctest && !!pins.sabotage,
  'D13a verify.sh 的 LOGIC_EXPECTS 解析到且只解析到两颗钉（doctest 与 sabotage）',
  pinBlock || 'verify.sh 里没有 LOGIC_EXPECTS 那一行');
// 钉的是"别人家的数"：一颗钉漂了，另一颗照样绿，所以两边各比一次。
const knives = rigKnives.length;
ok(!!pins.sabotage && +pins.sabotage === knives,
  'D13c verify.sh 钉的刀数等于台架源码现数的刀数（加一把刀要两处一起走）',
  `钉 ${pins.sabotage || '无'} · 现数 ${knives}`);
// D13b、D13d、D13e 各是本闸的一项，它们排在下面这三段里。
const finalRows = rows + 3;
ok(!!pins.doctest && +pins.doctest === finalRows,
  'D13b verify.sh 钉的 doctest 项数等于本闸实跑的项数（增删一条断言要两处一起走）',
  `钉 ${pins.doctest || '无'} · 实跑 ${finalRows}`);
// 调用要能在**非注释行**上数出来：README 里、注释里提一句路径不等于真的调了。
// 先剥缩进（这几条调用住在 `if` 块里），再剥行首的环境变量赋值（`FOO=1 python3 …` 那种）。
const cmds = VERIFY.split('\n').filter((l) => !/^\s*#/.test(l))
  .map((l) => l.replace(/^\s+/, '').replace(/^(?:[A-Z][A-Z0-9_]*=\S*\s+)+/, ''));
const trio = [
  ['node 套件', (l) => /^for f in test\/\*\.test\.mjs/.test(l)],
  ['doctest', (l) => /^node\s/.test(l) && l.includes('tools/doctest.mjs')],
  ['sabotage', (l) => /^python3\s/.test(l) && l.includes('tools/sabotage.py')],
];
const hits = trio.map(([, p]) => cmds.filter(p).length);
ok(hits.every((n) => n >= 1),
  'D13d 三道逻辑闸在 verify.sh 里各有一条真调用（注释里提到路径不算调用）',
  trio.map(([n], i) => `${n}=${hits[i]}`).join(' · '));
// README 那两个抄来的文档闸读数：一个是本闸裸跑的项数，另一个是加上 --measured 的项数。
// 加出来的那 6 行不手抄：它由 D5d 那一条加每条腿各一条比出来，腿数已经被 D5a 钉成 5。
const measuredExtra = 1 + legNames.length;
const docReadings = /本轮读数 \*\*`rows: (\d+) fail: 0`\*\*[\s\S]{0,200}?是 \*\*`rows: (\d+) fail: 0`\*\*[\s\S]{0,40}?多出来的 (\d+) 行/.exec(README);
ok(!!docReadings && +docReadings[1] === finalRows && +docReadings[2] === finalRows + measuredExtra
  && +docReadings[3] === measuredExtra,
  'D13e README 抄的两个文档闸读数等于本闸实跑项数与它加上 --measured 之后的项数',
  docReadings ? `裸跑 ${docReadings[1]}（实跑 ${finalRows}）· measured ${docReadings[2]}（应为 ${finalRows + measuredExtra}）· 差 ${docReadings[3]}（现算 ${measuredExtra}）`
    : '那一句解析不到三个数（改写了句子就要改这里，否则这两个数没人对账）');

console.log(`\n合计 ${rows} 项，${fail.length} 项失败`);
console.log(`rows: ${rows} fail: ${fail.length}`);
if (fail.length) {
  for (const f of fail) console.log(`  未过：${f}`);
  process.exit(1);
}
