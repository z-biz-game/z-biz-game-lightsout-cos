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
const DESIGN = existsSync(join(ROOT, 'DESIGN.md')) ? read('DESIGN.md') : '';
const DOCS = README + '\n' + DESIGN;
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
const scriptRows = tableByHeader('| script | 命令 | 本轮状态 |');
const docScripts = [...new Set(scriptRows.flatMap((c) => [...c[0].matchAll(/`([\w:]+)`/g)].map((x) => x[1])))];
const realScripts = Object.keys(PKG.scripts);
// 允许一行写两条（`\`start\` / \`dev\``），但合并数要当场数出来，不许拿"行对不上"当借口。
const merged = scriptRows.filter((c) => [...c[0].matchAll(/`([\w:]+)`/g)].length > 1).length;
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

// ---- D9 行号引用：文档写 path:NN 的，NN 必须落在真实行数里 ----
const cites = [...DOCS.matchAll(/`?([\w./-]+\.(?:js|mjs|cjs|sh|yml|css|html)):(\d+)(?:-(\d+))?`?/g)]
  // `{grid,gf2,solve}.js:NN` 那种花括号列举不是引用：它既没有目录、前面又贴着分隔符。
  // 不能按"前面是全角括号"丢——`（js/core/game.js:83-88` 是正经引用，本轮 L21 就是这么漏掉的。
  .filter((m) => m[1].includes('/') || !',{，（{'.includes(DOCS[m.index - 1] || ''));
const outRange = [];
for (const c of cites) {
  let rel = c[1];
  if (!existsSync(join(ROOT, rel))) {
    // 文档里也有只写文件名的引用（`solve.js:18`）：按文件名在仓里找，唯一命中才算引用得到。
    const hits = TRACKED.filter((p) => p === rel || p.endsWith('/' + rel));
    if (hits.length !== 1) { outRange.push(`${rel} 不存在${hits.length > 1 ? '（同名文件不唯一）' : ''}`); continue; }
    rel = hits[0];
  }
  const n = readFileSync(join(ROOT, rel), 'utf8').split('\n').length;
  if (+c[2] > n || (c[3] && +c[3] > n)) outRange.push(`${rel}:${c[2]}${c[3] ? '-' + c[3] : ''}（该文件只有 ${n} 行）`);
}
ok(cites.length >= 8, 'D9a 文档里解析到了行号引用（一条都没有就是这段没在跑）', `${cites.length} 条`);
ok(outRange.length === 0, 'D9 文档里的每条 path:NN 引用都落在真实文件的行数内（写了行号就得还在文件里）',
  outRange.length ? `越界：${outRange.join('，')}` : `${cites.length} 条全部在范围内`);

// ---- D10 追踪文件数：文档印的 `git ls-files | wc -l` 等于现在的仓 ----
const trackedCount = TRACKED.length;
const docTracked = /`git ls-files \| wc -l` = (\d+)/.exec(README);
ok(LS.status === 0 && trackedCount > 0 && !!docTracked && +docTracked[1] === trackedCount,
  'D10 文档说的追踪文件数等于 git ls-files 现在的数（新增一个文件要一起改文档）',
  `文档 ${docTracked && docTracked[1]} vs git ${trackedCount}（rc=${LS.status}）`);

// ---- D11 台账刀数：文档那张逐枪表的行号集合 == tools/sabotage.py 的 KNIVES ----
const docKnives = [...README.matchAll(/^\| (L\d+) \| /gm)].map((m) => m[1]);
const rigKnives = [...SAB.matchAll(/^\s{4}\('(L\d+)'/gm)].map((m) => m[1]);
ok(docKnives.length > 0 && rigKnives.length > 0,
  'D11a 台账两边都解析到了刀号（解析不到就别充绿）',
  `文档 ${docKnives.length} 行、台架 ${rigKnives.length} 把${SAB ? '' : '（台架文件不在树里）'}`);
ok(docKnives.join(',') === rigKnives.join(','),
  'D11 文档逐枪表的每一把刀都在台架里，台架的每一把都写进了文档',
  `文档 ${docKnives.join(' ')} vs 台架 ${rigKnives.join(' ')}`);

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

console.log(`\n合计 ${rows} 项，${fail.length} 项失败`);
console.log(`rows: ${rows} fail: ${fail.length}`);
if (fail.length) {
  for (const f of fail) console.log(`  未过：${f}`);
  process.exit(1);
}
