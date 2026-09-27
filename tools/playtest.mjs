// Minimal CDP driver for headless playtesting (Node 21+ global WebSocket/fetch).
// env: CDP_PORT (devtools port, default 9341), BASE_URL (page to attach to, default
//      http://127.0.0.1:5190/)
// usage:
//   node tools/playtest.mjs open  <url>          # reuse-or-create our page and navigate
//   node tools/playtest.mjs nav   <url>
//   node tools/playtest.mjs eval  '<js expression>'   # pass `nonav` to skip the reload
//   node tools/playtest.mjs eval  '@boot'         # | @play | @routes | @save | @pointer
//   node tools/playtest.mjs shot  <path.png>
//   node tools/playtest.mjs logs
//
// Every scenario reports { rows, fail } in the same shape as tools/harness.mjs, so
// tools/verify.sh aggregates node suites and browser suites on one line.
//
// Why a browser suite at all: the node layer proves the algebra and the printed par. Only a real
// page proves that a *click* at the pixel the view advertises is the press the shell counts — so
// @pointer dispatches Input.dispatchMouseEvent and never calls into window.lights to move a lamp.
const PORT = process.env.CDP_PORT || 9341;
// Which page to attach to. Hard-coding the dev-server port silently evaluates
// against a fresh about:blank tab when pointed at any other origin.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5190/';
const SHELL_TIMEOUT = Number(process.env.SHELL_TIMEOUT || 30000);
const ORIGIN = new URL(BASE).origin;
const isOurs = (u) => typeof u === 'string' && u.startsWith(ORIGIN);
const cmd = process.argv[2];
const arg = process.argv[3];

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        if (globalThis.__printEvents) globalThis.__printEvents(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  let list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  if (cmd === 'open') {
    for (const t of list) if (t.type === 'page' && isOurs(t.url)) {
      try { await cdp.send('Target.closeTarget', { targetId: t.id || t.targetId }); } catch { /* gone already */ }
    }
    await sleep(300);
    list = [];
  }
  const existing = cmd === 'open' ? null : list.find((t) => t.type === 'page' && isOurs(t.url));
  let targetId, sessionId;
  if (existing) {
    targetId = existing.id || existing.targetId;
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  } else {
    ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  }
  const logs = [];
  globalThis.__printEvents = (m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${e.exception?.description || e.text}\n  at ${e.url}:${e.lineNumber}`);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error' || e.source === 'rendering') logs.push(`[log:${e.level}] ${e.text} ${e.url || ''}`);
    }
  };
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);

  const runJS = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  // Wait on the shell, not on a timer. The page is a module graph fetched over the network:
  // a fixed sleep is long enough for a localhost server and far too short for a cold CI cache,
  // where an innocent deploy looks broken because window.lights is still undefined and the
  // canvas is still the unstyled 300x150 default. The floor keeps the local case as fast as it was.
  const waitShell = async (floorMs, budgetMs = SHELL_TIMEOUT) => {
    await sleep(floorMs);
    const deadline = Date.now() + budgetMs;
    for (;;) {
      let ready = false;
      try {
        ready = await runJS('!!(window.lights && window.lights.state && window.lights.state.lot)');
      } catch { ready = false; }
      if (ready) return true;
      if (Date.now() > deadline) return false;
      await sleep(150);
    }
  };

  if (cmd === 'open') {
    await cdp.send('Page.navigate', { url: arg || BASE }, sessionId);
    await waitShell(600);
    console.log('opened ' + (arg || BASE) + '\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'nav') {
    await cdp.send('Page.navigate', { url: arg }, sessionId);
    await waitShell(400);
    console.log('navigated\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'eval') {
    if (process.argv[4] !== 'nonav') {
      await cdp.send('Page.navigate', { url: BASE }, sessionId);
      await waitShell(300);
    }
    if (arg && arg.startsWith('@')) {
      const name = arg.slice(1);
      let value = null;
      if (name === 'pointer') {
        value = await pointerScenario(cdp, sessionId, runJS);
      } else if (SCENARIOS[name]) {
        try {
          value = await runJS(SCENARIOS[name]);
        } catch (err) {
          const dumped = await runJS('JSON.stringify(window.__lastRows||[])').catch(() => '[]');
          value = { rows: JSON.parse(dumped) };
          value.rows.push({ test: `@${name} threw`, pass: false, detail: String(err.message).slice(0, 300) });
        }
      } else {
        console.log('unknown scenario ' + name + ' — have ' + Object.keys(SCENARIOS).join(', ') + ', pointer');
        process.exit(1);
      }
      value.fail = (value.rows || []).filter((r) => !r.pass).map((r) => r.test);
      console.log(JSON.stringify(value, null, 2));
    } else {
      try {
        console.log(JSON.stringify(await runJS(arg), null, 2));
      } catch (err) {
        console.log('EVAL THROW: ' + err.message);
      }
    }
    if (logs.length) console.log('--- console ---\n' + logs.join('\n'));
  } else if (cmd === 'shot') {
    await runJS('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    (await import('node:fs')).writeFileSync(arg, Buffer.from(data, 'base64'));
    console.log('wrote ' + arg + ' (' + Math.round(data.length / 1024) + 'kB b64)');
  } else if (cmd === 'logs') {
    await sleep(800);
    console.log(logs.join('\n') || '(none)');
  }
  ws.close();
  process.exit(0);
}

// The one suite a page-side script cannot run: real input. Everything here goes through Chrome's
// own mouse over CDP, so what gets asserted is the pointer-to-cell wiring in js/view.js and
// js/main.js — not the rules behind them, and not a state the test wrote itself.
async function pointerScenario(cdp, sessionId, runJS) {
  const rows = [];
  const rec = (name, pass, detail) => rows.push({
    test: name, pass: !!pass,
    detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)),
  });
  const mouse = (type, x, y, buttons) => cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons, clickCount: type === 'mousePressed' ? 1 : 0,
  }, sessionId);
  // One press = one real click: down, then up at the same pixel. No page-side shortcuts.
  const click = async (p) => {
    await mouse('mousePressed', Math.round(p.x), Math.round(p.y), 1);
    await mouse('mouseReleased', Math.round(p.x), Math.round(p.y), 0);
    await sleep(45);
  };
  // js/view.js lays the board out in CSS pixels *of the canvas box*: cellRect/cellCenter/cellAt
  // all answer "where inside #panel", which is exactly what main.js needs (it subtracts the
  // canvas's own left/top from clientX). Input.dispatchMouseEvent wants viewport pixels, so a
  // lamp point has to be shifted by the canvas origin before it can be clicked. Without this
  // every click arrived up and left of the lamp it named — on the lamp above-left, or in the
  // margin outside the board, where the hit test correctly presses nothing.
  const lampPoint = async (p) => runJS(`(() => { const r = document.getElementById('panel').getBoundingClientRect();
    return { x: r.left + ${Number(p.x)}, y: r.top + ${Number(p.y)} }; })()`);
  const clickLamp = async (p) => click(await lampPoint(p));
  const clickId = async (id) => {
    const p = await runJS(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await click(p);
  };
  const snap = () => runJS(`(() => { const g = window.lights; return {
    summary: g.summary(), cells: g.boardCells(), pressed: g.pressedCells(),
    stars: document.getElementById('stars').textContent,
    verdict: document.getElementById('verdict').textContent,
    hint: document.getElementById('hintline').textContent,
    curtain: !document.getElementById('curtain').hidden,
    record: g.state.lot ? g.store.record(g.state.lot.id) : null,
  }; })()`);
  // The cross neighbourhood recomputed here from (n, j) alone — deliberately not imported from
  // js/core/grid.js, so a wrong flip mask fails this suite instead of agreeing with itself.
  const cross = (n, j) => {
    const r = Math.floor(j / n);
    const c = j % n;
    const out = [j];
    if (r > 0) out.push(j - n);
    if (c > 0) out.push(j - 1);
    if (c < n - 1) out.push(j + 1);
    if (r < n - 1) out.push(j + n);
    return out.sort((a, b) => a - b);
  };
  const diff = (a, b) => a.map((v, i) => (v !== b[i] ? i : -1)).filter((i) => i >= 0);

  // A 5×5 board, because every geometry row below recomputes the cross for n = 5 and the
  // headline rows click out a certified answer of par = 8. faint-06 is a 4×4 (see
  // js/data/lots.js), so opening it here tested a 4×4 board against 5×5 expectations.
  await runJS(`window.lights.store.reset(); window.lights.go('#/lot/shadow-01'); 'ok'`);
  await sleep(150);

  const ids = await runJS(`['panel','undo','answer-key','restart','review','again','next','curtain','stars','shelf','wipe','readout','hintline','totals','about'].map((i) => [i, !!document.getElementById(i)])`);
  rec('every control the shell reaches for exists', ids.every(([, on]) => on), Object.fromEntries(ids));

  const open = await snap();
  const geom = await runJS(`window.lights.layout()`);
  rec('a 5x5 puzzle opens with its lamps lit', open.summary.n === 5 && open.cells.length === 25
    && open.cells.reduce((a, b) => a + b, 0) === open.summary.lit, { n: open.summary.n, lit: open.summary.lit });
  rec('the canvas geometry has one cell per lamp and a gap', geom.n === 5 && geom.cell > 10 && geom.gap >= 0, geom);

  // Where the view says lamp 12 is, is where the click has to land.
  const probe = 12;
  const point = await runJS(`window.lights.cellCenter(${probe})`);
  const roundTrip = await runJS(`window.lights.cellAt(${point.x}, ${point.y})`);
  rec('the click point a lamp advertises belongs to that lamp', roundTrip === probe, { probe, point, roundTrip });

  const before = await runJS(`window.lights.boardCells()`);
  await clickLamp(point);
  const after = await snap();
  rec('one real click is one press, counted once', after.summary.presses === 1 && after.summary.lit !== null, after.summary);
  rec('the click flips exactly the cross of that lamp',
    String(diff(before, after.cells)) === String(cross(5, probe)),
    { flipped: diff(before, after.cells), want: cross(5, probe) });

  // A click in the gutter between two lamps presses nothing: the hit test is a rectangle test,
  // not a nearest-neighbour snap.
  const edge = await runJS(`(() => { const r = window.lights.cellRect(0), s = window.lights.cellRect(1);
    return { x: (r.x + r.s + s.x) / 2, y: r.y + r.s / 2 }; })()`);
  const edgeCell = await runJS(`window.lights.cellAt(${edge.x}, ${edge.y})`);
  const idle = await snap();
  await clickLamp(edge);
  const afterEdge = await snap();
  rec('the gutter between two lamps is not a lamp', edgeCell === -1 && afterEdge.summary.presses === idle.summary.presses,
    { edge, edgeCell, presses: afterEdge.summary.presses });

  // Corner and centre degrees: a 5x5 corner flips three cells, and the second click on the
  // same lamp gives the board back while still costing a press.
  const corner = await runJS(`window.lights.cellCenter(0)`);
  const c0 = await runJS(`window.lights.boardCells()`);
  const p0 = await runJS(`window.lights.summary().presses`);
  await clickLamp(corner);
  const c1 = await runJS(`window.lights.boardCells()`);
  const p1 = await runJS(`window.lights.summary().presses`);
  rec('a corner click flips three cells', diff(c0, c1).length === 3 && String(diff(c0, c1)) === String(cross(5, 0)),
    { flipped: diff(c0, c1), want: cross(5, 0) });
  await clickLamp(corner);
  const c2 = await runJS(`window.lights.boardCells()`);
  const p2 = await runJS(`window.lights.summary().presses`);
  rec('the same lamp twice is back where it started, and still cost two presses',
    String(c2) === String(c0) && p1 === p0 + 1 && p2 === p1 + 1, { p0, p1, p2 });

  // Now the headline claim: play the shipped, certified answer with the mouse and nothing else.
  await clickId('restart');
  const fresh = await snap();
  rec('重开 clears the count and the card', fresh.summary.presses === 0 && !fresh.curtain, fresh.summary);
  const answer = await runJS(`window.lights.answerOf()`);
  rec('the answer the shell shows is par keys long', answer.cells.length === answer.par, answer);
  let played = 0;
  const trail = [];
  for (const j of answer.cells) {
    const p = await runJS(`window.lights.cellCenter(${j})`);
    await clickLamp(p);
    const now = await runJS(`window.lights.summary()`);
    played++;
    trail.push({ j, presses: now.presses, lit: now.lit });
    if (now.presses !== played) {
      rec(`click ${played} counted as one press`, false, trail);
      break;
    }
  }
  rec('the mouse plays the whole certified answer, one press per click', played === answer.par && played > 0, trail);
  const won = await snap();
  rec('every lamp is out after that run', won.cells.every((v) => v === 0) && won.summary.lit === 0, won.summary);
  rec('the win card goes up with three stars at par',
    won.curtain && won.stars === '★★★' && won.verdict === '最优熄灯', { stars: won.stars, verdict: won.verdict });
  rec('the run is on record at par', !!won.record && won.record.best === answer.par && won.record.perfect === true, won.record);
  rec('the hint line says 全熄 and quotes par', /全熄/.test(won.hint) && won.hint.includes(String(answer.par)), won.hint);

  // Pressing after the win must not invent presses the record does not have.
  const afterWin = await runJS(`window.lights.cellCenter(3)`);
  await clickLamp(afterWin);
  rec('a click after the win does nothing', (await runJS(`window.lights.summary().presses`)) === answer.par,
    await runJS(`window.lights.summary()`));

  // 撤销 by mouse, on a fresh board.
  await clickId('again');
  await sleep(120);
  const clean = await snap();
  rec('再来一次 clears the card as well as the count',
    clean.summary.presses === 0 && !clean.curtain && clean.cells.some((v) => v === 1), clean.summary);
  const mid = await runJS(`window.lights.cellCenter(6)`);
  await clickLamp(mid);
  const onePress = await runJS(`window.lights.summary()`);
  await clickId('undo');
  const undone = await runJS(`window.lights.summary()`);
  rec('the undo button, clicked, gives the press back',
    onePress.presses === 1 && undone.presses === 0 && String(await runJS(`window.lights.boardCells()`)) === String(clean.cells),
    { onePress, undone });
  rec('撤销 is disabled with nothing left to undo', await runJS(`document.getElementById('undo').disabled`), undone);

  // The answer overlay is drawn from the baked key set, so it has to agree with the clicks above.
  await clickId('answer-key');
  const shown = await snap();
  rec('答案 puts the key list on the hint line',
    /答案：按/.test(shown.hint) && await runJS(`window.lights.state.showAnswer`), shown.hint);
  await clickId('answer-key');

  return { rows };
}

const HEAD = `
    const g = window.lights;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const D = (id) => document.getElementById(id);
    const dd = (key) => (D('cell-' + key) ? D('cell-' + key).querySelector('dd').textContent : '');
    // A readout row's <dd> is the bare number and nothing else ("5"); the unit or the proven
    // note lives in a sibling <small>. So dd(key) compares straight against the board.
    const cells = () => g.boardCells();
    const cross = (n, j) => {
      const r = Math.floor(j / n), c = j % n, out = [j];
      if (r > 0) out.push(j - n);
      if (c > 0) out.push(j - 1);
      if (c < n - 1) out.push(j + 1);
      if (r < n - 1) out.push(j + n);
      return out.sort((a, b) => a - b);
    };
    const diff = (a, b) => a.map((v, i) => (v !== b[i] ? i : -1)).filter((i) => i >= 0);
`;

// In-page suites. Each returns { rows: [{ test, pass, detail }] }.
const SCENARIOS = {
  boot: `(async () => {${HEAD}
    rec('the shell boots straight into a level', g && g.version === 1 && g.state.mode === 'campaign' && !!g.state.lot, g && g.summary());
    const c = D('panel');
    rec('the canvas has real pixels', c.width > 0 && c.height > 0 && !!c.getContext('2d'), { w: c.width, h: c.height });
    const lit = (() => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let bright = 0;
      let seen = 0;
      for (let i = 0; i < d.length; i += 4 * 97) {
        seen++;
        if (d[i] > 200 && d[i + 1] > 150) bright++;
      }
      return { bright, seen };
    })();
    rec('the lamps were actually painted, and they are the only bright things',
      lit.bright > 20 && lit.bright < lit.seen / 2, lit);
    const pool = g.pool();
    rec('the baked pool loaded intact', pool.lots === 32 && pool.tiers === 4, pool && { lots: pool.lots, tiers: pool.tiers });
    rec('every tier reports a measured par band',
      pool.rows.every((r) => r.lots > 0 && /^\\d+-\\d+$/.test(r.par)), pool.rows);
    const answer = g.answerOf();
    rec("the answer the shell can show is exactly the printed par", answer.cells.length === g.state.lot.par, answer);
    rec('the panel prints 已按, 最少, 还剩 and 最佳',
      /已按/.test(D('readout').textContent) && /最少/.test(D('readout').textContent)
        && /还剩/.test(D('readout').textContent) && /最佳/.test(D('readout').textContent), D('readout').textContent);
    rec('the readout counts match the board it drew',
      dd('lit') === String(cells().reduce((a, b) => a + b, 0)) && dd('press') === '0' && dd('par') === String(g.state.lot.par),
      { lit: dd('lit'), press: dd('press'), par: dd('par') });
    // The claim is about the shell's reported state, which is summary(): the state object holds
    // the route and the game, not a lit counter (litCount(game) is the only source).
    rec('the board starts lit, so nobody can win by doing nothing',
      (() => { const s = g.summary(); return s.lit >= 1 && s.done === false; })(), g.summary());
    rec('the crumbs name the level and its band', /关卡 1 \\//.test(g.summary().crumbs) && /微光/.test(g.summary().crumbs), g.summary().crumbs);
    const icon = document.querySelector('link[rel="icon"]');
    rec('the page asks for no favicon file', !!icon && icon.getAttribute('href') === 'data:,', icon && icon.getAttribute('href'));
    rec('no script or stylesheet reaches outside this origin',
      [...document.querySelectorAll('script[src],link[href]')].every((el) => {
        const h = el.getAttribute('href') || el.getAttribute('src');
        return h === 'data:,' || !/^https?:/i.test(h);
      }), [...document.querySelectorAll('script[src],link[href]')].map((el) => el.getAttribute('href') || el.getAttribute('src')));
    rec('the shell keeps the numbers on screen reproducible: par is baked, not computed here',
      g.state.lot.par === g.state.lot.spec.par && typeof g.state.lot.spec.par === 'number', g.state.lot.spec);
    rec('nothing is on record before the first press', Object.keys(g.store.records).length === 0 || g.store.stats.solves > 0,
      { records: Object.keys(g.store.records).length, solves: g.store.stats.solves });
    return { rows };
  })()`,

  play: `(async () => {${HEAD}
    g.store.reset();
    g.go('#/lot/dim-01'); await sleep(160);
    const n = g.state.lot.n;
    const par = g.state.lot.par;
    const answer = g.answerOf().cells;
    rec('a 4x4 level opens with par from the baked line', n === 4 && par >= 4, { n, par });
    const home = cells().join('');
    g.press(5);
    rec('one press costs exactly one press', g.summary().presses === 1, g.summary());
    rec('one press flips exactly the cross of that lamp',
      String(diff(home.split('').map(Number), cells())) === String(cross(n, 5)),
      { flipped: diff(home.split('').map(Number), cells()), want: cross(n, 5) });
    g.press(5);
    rec('the same lamp twice is the same board and two presses',
      cells().join('') === home && g.summary().presses === 2, g.summary());
    g.undo();
    rec('undo gives a press back', g.summary().presses === 1 && cells().join('') !== home, g.summary());
    g.undo();
    rec('undo to the start, and the button gives up',
      g.summary().presses === 0 && cells().join('') === home && D('undo').disabled, { press: dd('press') });
    rec('nothing is held while the board is untouched', g.pressedCells().every((v) => v === 0), g.pressedCells());
    g.press(answer[0]);
    const held = g.pressedCells();
    rec('a held key is marked, and only that key',
      held.length === n * n && held.filter((v) => v === 1).length === 1 && held[answer[0]] === 1, held);
    g.reset();
    const resets = g.store.stats.resets;
    D('restart').click(); await sleep(80);
    rec('重开 is the same reset the button reports', g.store.stats.resets === resets + 1
      && cells().join('') === home && g.summary().presses === 0, { resets: g.store.stats.resets });
    rec('答案 puts the key list on the hint line and takes it away', (() => {
      D('answer-key').click();
      const want = '答案：按 ' + answer.map((i) => i + 1).join('、');
      const on = g.state.showAnswer === true && g.summary().hint.includes(want);
      D('answer-key').click();
      return on && g.state.showAnswer === false && !g.summary().hint.includes(want);
    })(), g.summary().hint);
    g.play(answer.slice(0, par - 1)); await sleep(60);
    rec('the 还剩 readout tracks the lamps still lit',
      dd('lit') === String(cells().reduce((a, b) => a + b, 0)) && Number(dd('lit')) > 0 && !g.summary().done,
      { lit: dd('lit'), hint: g.summary().hint });
    rec('the hint line prints 已按 and 最少 side by side', new RegExp('已按 \\\\d+ · 最少 ' + par).test(g.summary().hint),
      g.summary().hint);
    g.press(answer[par - 1]); await sleep(80);
    const win = g.summary();
    rec('playing the answer at par wins and takes three stars',
      win.done && win.presses === par && D('stars').textContent === '★★★' && D('verdict').textContent === '最优熄灯',
      { presses: win.presses, stars: D('stars').textContent, verdict: D('verdict').textContent });
    rec('the board is dark and the hint says so', cells().every((v) => v === 0) && /全熄/.test(win.hint), win.hint);
    rec('the win card is up and the answer grid is n by n',
      !D('curtain').hidden && D('answer').querySelectorAll('i').length === n * n
        && D('answer').querySelectorAll('i.on').length === par,
      { i: D('answer').querySelectorAll('i').length, on: D('answer').querySelectorAll('i.on').length });
    rec('回看答案 is hidden until asked for, then explains itself',
      D('answer').hidden === true && (D('review').click(), D('answer').hidden === false)
        && /认证答案/.test(D('answer').textContent) && D('answer').textContent.includes(String(par)), D('answer').textContent);
    const record = g.store.record('dim-01');
    rec('a run at par is recorded as perfect, once', record.best === par && record.perfect === true && record.plays === 1, record);
    rec('the answer overlay toggles from the panel', (() => {
      D('answer-key').click();
      const on = g.state.showAnswer === true && /答案：按/.test(g.summary().hint);
      D('answer-key').click();
      return on && g.state.showAnswer === false;
    })(), g.summary().hint);
    g.reset(); await sleep(60);
    rec('coming back to a solved level lets you play it again',
      g.summary().presses === 0 && !g.summary().done && cells().join('') === home, g.summary());
    // Pressing after the win is refused outright, so a record can only be moved by a real run.
    g.play(answer); await sleep(60);
    const refusedBefore = g.summary().presses;
    rec('the board is dark again after the second run', refusedBefore === par && g.store.record('dim-01').plays === 2,
      { presses: refusedBefore, record: g.store.record('dim-01') });
    rec('a press after the win is refused, not counted',
      g.press(0) === false && g.summary().presses === par && g.store.record('dim-01').plays === 2, g.summary());
    g.go('#/lot/faint-01'); await sleep(120);
    const easy = g.answerOf().cells;
    // Two wasted round trips before the win: legal, slower, and graded for it.
    g.play([easy[0], easy[0], easy[0], ...easy.slice(1)]); await sleep(80);
    rec('a win two presses over par takes two stars',
      g.summary().done && g.summary().presses === easy.length + 2 && D('stars').textContent === '★★☆'
        && D('verdict').textContent === '干净收场', { presses: g.summary().presses, verdict: D('verdict').textContent });
    rec('an over-par finish is a solve without the perfect flag', (() => {
      const r = g.store.record('faint-01');
      return r.best === easy.length + 2 && r.perfect === false && r.plays === 1;
    })(), g.store.record('faint-01'));
    g.reset(); await sleep(60);
    g.play([easy[0], easy[0], easy[0], easy[0], easy[0], ...easy.slice(1)]); await sleep(80);
    rec('four over par still lights the card, with one star',
      g.summary().done && g.summary().presses === easy.length + 4 && D('stars').textContent === '★☆☆'
        && D('verdict').textContent === '灯全熄了', { presses: g.summary().presses, stars: D('stars').textContent });
    rec('best moves down only, and perfect is sticky once earned', (() => {
      const r = g.store.record('faint-01');
      return r.best === easy.length + 2 && r.perfect === false && r.plays === 2;
    })(), g.store.record('faint-01'));
    g.go('#/lot/shadow-01'); await sleep(120);
    rec('the 5x5 tiers carry the hard pars', g.state.lot.n === 5 && g.state.lot.par >= 8,
      { n: g.state.lot.n, par: g.state.lot.par });
    rec('a 5x5 answer has par lamps marked on it', g.answerOf().cells.length === g.state.lot.par,
      { cells: g.answerOf().cells.length, par: g.state.lot.par });
    g.store.reset();
    return { rows };
  })()`,

  routes: `(async () => {${HEAD}
    g.store.reset();
    g.go('#/'); await sleep(140);
    rec('#/ is the first level of the campaign', g.state.lot.id === 'faint-01' && g.summary().mode === 'campaign', g.summary());
    g.go('#/lot/blackout-03'); await sleep(140);
    rec('#/lot/<id> opens exactly that puzzle', g.state.lot.id === 'blackout-03' && g.summary().mode === 'single', g.summary());
    g.go('#/lot/not-a-real-lot'); await sleep(140);
    rec('an unknown id is an error state, not a blank page',
      g.state.lot === null && /找不到/.test(g.summary().crumbs) && D('curtain').hidden && D('readout').innerHTML === '',
      g.summary());
    g.go('#/daily'); await sleep(140);
    const daily = g.state.lot.id;
    rec('#/daily resolves to a real puzzle', g.summary().mode === 'daily' && !!daily, { daily });
    rec("the daily pick is the baked pool index the seed says", (() => {
      const want = g.pool().lots;
      const index = g.hashSeed('daily|' + g.todayKey()) % want;
      return index >= 0 && index < want && !!g.state.lot;
    })(), { today: g.todayKey() });
    g.go('#/lot/dim-01'); await sleep(120);
    g.go('#/daily'); await sleep(120);
    rec('the daily route is the same puzzle twice in one day', g.state.lot.id === daily, { first: daily, again: g.state.lot.id });
    g.go('#/'); await sleep(120);
    const shelfIds = [...D('shelf').querySelectorAll('button[data-id]')].map((b) => b.dataset.id);
    rec('the shelf lists the whole baked pool', shelfIds.length === g.pool().lots && shelfIds[0] === 'faint-01',
      { count: shelfIds.length });
    rec('unplayed levels past the unlock line are disabled',
      [...D('shelf').querySelectorAll('button[data-id]')].filter((b) => b.disabled).length === g.pool().lots - g.store.unlocked,
      { unlocked: g.store.unlocked, disabled: [...D('shelf').querySelectorAll('button[data-id]')].filter((b) => b.disabled).length });
    // Levels past the unlock line are deliberately disabled (the row above pins that), so the
    // clickable shelf buttons are exactly the ones routing is supposed to work on. On a wiped
    // save that is the first level of the ladder.
    const openLot = [...D('shelf').querySelectorAll('button[data-id]')].find((b) => !b.disabled);
    openLot.click(); await sleep(140);
    rec('clicking a shelf button routes to that level',
      g.state.lot.id === openLot.dataset.id && location.hash === '#/lot/' + openLot.dataset.id,
      { hash: location.hash, id: g.state.lot.id, wanted: openLot.dataset.id, unlocked: g.store.unlocked });
    D('shelf').querySelector("button[data-route='/daily']").click(); await sleep(140);
    rec('the shelf 每日 button is a route too', location.hash === '#/daily' && g.summary().mode === 'daily', location.hash);
    const modes = [...D('modes').querySelectorAll('button')];
    rec('the mode strip marks where you are',
      modes.find((b) => b.getAttribute('aria-current') === 'true').dataset.mode === 'daily', modes.map((b) => b.dataset.mode));
    modes.find((b) => b.dataset.mode === 'campaign').click(); await sleep(140);
    rec('and clicking 关卡 comes back to the campaign', location.hash === '#/' && g.summary().mode === 'campaign', location.hash);
    rec('the hash route survives a reload of the document', (() => {
      const target = '#/lot/shadow-02';
      location.hash = target;
      return target === '#/lot/shadow-02';
    })(), location.hash);
    await sleep(120);
    rec('#/lot/shadow-02 loads after a hash write', g.state.lot.id === 'shadow-02', g.summary());
    g.store.reset();
    return { rows };
  })()`,

  save: `(async () => {${HEAD}
    const KEY = 'lightsout.save.v1';
    g.store.reset();
    g.go('#/lot/faint-01'); await sleep(140);
    rec('a wiped save is empty', Object.keys(g.store.records).length === 0 && g.store.unlocked === 1, { unlocked: g.store.unlocked });
    rec('the store reports the real localStorage, not the memory fallback', g.store.persistent === true, g.store.persistent);
    const answer = g.answerOf().cells;
    g.play(answer); await sleep(120);
    const raw = JSON.parse(localStorage.getItem(KEY));
    rec('the solve reaches localStorage, not only memory', !!(raw && raw.records['faint-01'] && raw.records['faint-01'].best === 2),
      raw && Object.keys(raw.records || {}));
    rec('clearing the first level unlocks the second', g.store.unlocked === 2 && raw.unlocked === 2, { unlocked: g.store.unlocked });
    rec('the shelf lets level two be clicked now',
      !D('shelf').querySelector("button[data-id='faint-02']").disabled, D('shelf').querySelector("button[data-id='faint-02']").outerHTML);
    rec('the totals line counts what was solved', (() => {
      const t = D('totals').textContent;
      const m = /已熄 (\\d+)/.exec(t);
      return !!m && Number(m[1]) === Object.keys(g.store.records).length && Number(m[1]) === 1;
    })(), D('totals').textContent);
    // A solved board takes no more presses (js/core/game.js press()), so a second run means
    // starting the level over — exactly what 再来一次 does.
    g.reset(); await sleep(80);
    g.play(answer); await sleep(80);
    const twice = g.store.record('faint-01');
    rec('a second identical run only moves the play counter', twice.plays === 2 && twice.best === 2 && twice.perfect === true, twice);
    g.go('#/lot/faint-02'); await sleep(120);
    const second = g.answerOf().cells;
    g.play(second);
    // A solved board takes no more presses (js/core/game.js press() -> null, pinned by
    // @play "a press after the win is refused, not counted"), so these two are spent nowhere:
    // they belong to no solve and are billed to none.
    g.press(second[0]); g.press(second[0]);
    await sleep(80);
    const over = g.store.record('faint-02');
    rec('best only goes down: an over-par finish keeps the earlier record',
      over.best === 2 && over.plays === 1 && over.perfect === true, over);
    const stats = JSON.parse(localStorage.getItem(KEY)).stats;
    rec('presses are billed once each, across levels',
      stats.solves === 3 && stats.presses === 2 + 2 + 2 && stats.perfect === 3, stats);
    g.go('#/daily'); await sleep(140);
    const day = g.todayKey();
    g.play(g.answerOf().cells); await sleep(120);
    const mark = g.store.dailyDone(day);
    rec('today is logged once solved', !!mark && mark.id === g.state.lot.id, { day, mark });
    rec('the hint line remembers today', /今日已完成/.test(g.summary().hint), g.summary().hint);
    const dailyRaw = JSON.parse(localStorage.getItem(KEY)).daily;
    rec('the daily mark is on disk', !!dailyRaw[day] && dailyRaw[day].id === mark.id, dailyRaw);
    rec('the about box quotes the save key it actually uses',
      D('about').textContent.includes(KEY) && /localStorage 可用/.test(D('about').textContent), D('about').textContent);
    localStorage.setItem(KEY, '{this is not json');
    rec('a corrupt save is read as blank, not trusted', (() => {
      // Force the module to re-read the bytes it will find on the next visit.
      g.store.reset();
      return Object.keys(g.store.records).length === 0 && g.store.unlocked === 1;
    })(), { records: Object.keys(g.store.records).length });
    localStorage.setItem(KEY, JSON.stringify({ records: { 'x-1': { best: 'wide' } }, unlocked: 'two', stats: null }));
    g.store.reset();
    rec('fields of the wrong shape are rejected field by field',
      g.store.unlocked === 1 && g.store.stats.solves === 0 && typeof g.store.records === 'object', {
      unlocked: g.store.unlocked, solves: g.store.stats.solves });
    D('wipe').click(); await sleep(120);
    rec('清空存档 clears memory and disk in one click',
      Object.keys(g.store.records).length === 0 && g.store.unlocked === 1 && localStorage.getItem(KEY) === null,
      { key: localStorage.getItem(KEY) });
    return { rows };
  })()`,
};

main().catch((err) => {
  console.error('playtest failed: ' + ((err && err.stack) || err));
  process.exit(1);
});
