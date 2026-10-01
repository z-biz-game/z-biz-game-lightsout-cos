// The shell: hash routes, buttons, the save file, and the canvas. Nothing in here decides what
// is true — the board maths is js/core/grid.js, the certified minimum is js/core/gf2.js, and the
// level list was frozen by tools/bake.mjs. A click does three things and no more: XOR one flip
// mask, add one to the counter, ask the view to pulse. There is no search at click time.

import { cellsOf } from './core/grid.js';
import { ALL, TIERS, byId, tierByKey, lotsIn, campaign, levelAt, dailyLot, summaryTable } from './core/library.js';
import { createGame, press, undo, reset, boardCells, litCount, grade, answerCells } from './core/game.js';
import { store, SAVE_KEY } from './core/storage.js';
import { hashSeed, todayKey } from './core/rng.js';
import { createView } from './view.js';
import { createClock } from './clock.js';
import { createAudio } from './audio.js';

const dom = {
  canvas: document.getElementById('panel'),
  modes: document.getElementById('modes'),
  totals: document.getElementById('totals'),
  crumbs: document.getElementById('crumbs'),
  readout: document.getElementById('readout'),
  hintline: document.getElementById('hintline'),
  shelf: document.getElementById('shelf'),
  about: document.getElementById('about'),
  curtain: document.getElementById('curtain'),
  stars: document.getElementById('stars'),
  verdict: document.getElementById('verdict'),
  tally: document.getElementById('tally'),
  answer: document.getElementById('answer'),
  undo: document.getElementById('undo'),
  answerKey: document.getElementById('answer-key'),
  restart: document.getElementById('restart'),
  review: document.getElementById('review'),
  again: document.getElementById('again'),
  next: document.getElementById('next'),
  wipe: document.getElementById('wipe'),
  pause: document.getElementById('pause'),
  mute: document.getElementById('mute'),
  fullscreen: document.getElementById('fullscreen'),
  help: document.getElementById('help'),
  helpCard: document.getElementById('help-card'),
  helpClose: document.getElementById('help-close'),
  helpStart: document.getElementById('help-start'),
};

const prefersReducedMotion = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

const view = createView(dom.canvas, { reduceMotion: prefersReducedMotion });
const audio = createAudio();

const state = {
  mode: 'campaign',
  cursor: 0,
  lot: null,
  game: null,
  showAnswer: false,
  missing: null,
  paused: false,
  helpOpen: false,
  saveNote: null,
};

// HUD 上那个"用时"是 clock 的虚拟秒，不是 Date.now() 差值：暂停期间 clock 不推进，
// 读出来的数就真的是"你想这件事想了多久"。DOM 只在整秒跳变时改文本，逐帧写
// innerHTML 会让 readout 每帧重排一次。
let hudSecond = -1;
const clock = createClock({
  onFrame: (dt, stamp) => {
    view.step(dt, stamp);
    const sec = Math.floor(clock.stats().elapsed);
    if (sec !== hudSecond && !state.paused) {
      hudSecond = sec;
      renderTime();
    }
  },
  // 回合制游戏不该让 rAF 空转：只有"还在解这一关"或"还有东西在动"时才要下一帧。
  shouldRun: () => (state.game && !state.game.done && !state.paused && !state.helpOpen) || view.busy(),
});

// ---- routing ---------------------------------------------------------------

// Three routes and no more: the ladder, one named puzzle, and today's. Anything else is an
// error state the shell renders instead of a silent redirect — a stale shared link should say so.
function parseRoute(hash) {
  const clean = String(hash || '').replace(/^#/, '').replace(/\/+$/, '');
  if (clean === '' || clean === '/') return { mode: 'campaign' };
  if (clean === '/daily') return { mode: 'daily' };
  const one = /^\/lot\/([\w-]+)$/.exec(clean);
  if (one) return { mode: 'single', id: one[1] };
  return { mode: 'unknown', hash: clean };
}

function routeFromLocation() {
  return parseRoute(location.hash);
}

function campaignIds() {
  return campaign().map((l) => l.id);
}

function dailyId() {
  const lot = dailyLot(todayKey());
  return lot ? lot.id : campaignIds()[0];
}

// ---- one puzzle on screen ---------------------------------------------------

function loadLot(lot) {
  state.lot = lot;
  state.game = createGame(lot);
  state.showAnswer = false;
  state.paused = false;
  view.setPaused(false);
  clock.setPaused(false);
  view.resetFx();
  clock.reset();
  hudSecond = -1;
  paint();
  clock.invalidate();
}

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// The certified answer as cell indices: read off the baked key set, never searched for. Cached
// per lot because paint() runs on every press.
const answerIndexCache = new Map();
function answerOf(lot) {
  const hit = answerIndexCache.get(lot.id);
  if (hit) return hit;
  const cells = answerCells(createGame(lot)).map(({ r, c }) => (r - 1) * lot.n + (c - 1));
  answerIndexCache.set(lot.id, cells);
  return cells;
}

function pressedOf(game) {
  const out = new Array(game.n * game.n).fill(0);
  // A key pressed twice is off again — the stack is a history, the board is a parity.
  const parity = new Set();
  for (const j of game.back) {
    if (parity.has(j)) parity.delete(j);
    else parity.add(j);
  }
  for (const j of parity) out[j] = 1;
  return out;
}

function starsMarkup(on) {
  return [0, 1, 2].map((i) => `<span class="${i < on ? '' : 'dim'}">${i < on ? '★' : '☆'}</span>`).join('');
}

// One field, one number: `<dd>` holds the value alone and the unit or proven note goes in a
// sibling `<small>`. A readout that printed "2枚举 16 个陪集" as one field cannot be read back
// by anything but a human eye — the shell's own test surface (`#cell-<key> dd`) has to be a
// number when the row is a number. The win/lose class lands on the `<dd>` because that is the
// selector css/game.css styles (`.readout .lit dd.lose`).
function renderReadout() {
  const { lot, game } = state;
  const rec = store.record(lot.id);
  const g = grade(game);
  const rows = [
    ['size', '盘面', `${lot.n}×${lot.n}`, `${lot.lit} 盏亮着`, ''],
    ['press', '已按', String(game.presses), '次', ''],
    ['par', '最少', String(lot.par), `陪集 ${2 ** lot.nullity} 个候选`, ''],
    ['lit', '还剩', String(litCount(game)), '盏亮着', game.done ? 'win' : 'lose'],
    ['best', '最佳', rec ? String(rec.best) : '—', rec ? `${rec.plays} 次通关` : '未挑战', ''],
    ['time', '用时', formatClock(clock.stats().elapsed), state.paused ? '已暂停，不计入' : '想的时间', ''],
    ['stars', '评级', starsMarkup(g.stars), g.label, ''],
  ];
  dom.readout.innerHTML = rows.map(([key, label, value, note, klass]) =>
    `<div class="${key}" id="cell-${key}"><dt>${label}</dt><dd${klass ? ` class="${klass}"` : ''}>${value}</dd>`
    + `<small>${note}</small></div>`).join('');
}

// 每秒一次，只碰"用时"这一格：整块 readout 重建会把 hover 状态和布局一起打掉。
function renderTime() {
  const cell = dom.readout.querySelector('#cell-time');
  if (!cell) return;
  cell.querySelector('dd').textContent = formatClock(clock.stats().elapsed);
  cell.querySelector('small').textContent = state.paused ? '已暂停，不计入' : '想的时间';
}

function renderCrumbs() {
  const { lot } = state;
  const tier = tierByKey(lot.tier);
  const where = campaignIds().indexOf(lot.id);
  const trail = state.mode === 'daily'
    ? `每日 · ${todayKey()}`
    : state.mode === 'campaign'
      ? `关卡 ${state.cursor + 1} / ${ALL.length}`
      : `曲库 #/lot/${lot.id}`;
  dom.crumbs.innerHTML = `${trail}<b>${lot.id}</b><span class="band">${tier.label} · ${tier.blurb}`
    + `${where >= 0 ? ` · 第 ${where + 1} 关` : ''}</span>`;
}

function renderHint() {
  const { lot, game } = state;
  const bits = [`已按 <b>${game.presses}</b>`, `最少 <b>${lot.par}</b>`, `还剩 <b>${litCount(game)}</b> 盏`];
  let line = bits.join(' · ');
  if (game.done) {
    line = `全熄 · ${grade(game).label} · ` + line;
  } else if (game.presses > lot.par) {
    line += ' <span class="answer-line">已超过最少次数，重开再试</span>';
  }
  // The key list rides along whenever the panel's 答案 switch is on — including after the win,
  // where the overlay is up anyway and the answer is no longer a spoiler. Gating it on the
  // board being unsolved made the button do nothing visible exactly when the player is most
  // likely to reach for it.
  if (state.showAnswer) {
    line += ` <span class="answer-line">答案：按 ${answerOf(lot).map((i) => i + 1).join('、')}</span>`;
  }
  if (state.mode === 'daily' && store.dailyDone(todayKey())) line += ' <span class="answer-line">今日已完成</span>';
  if (state.saveNote) {
    line += ` <span class="answer-line">${state.saveNote}</span>`;
    state.saveNote = null;
  }
  dom.hintline.innerHTML = line;
}

function renderTotals() {
  const rows = summaryTable();
  const solved = ALL.filter((l) => store.record(l.id)).length;
  const perfect = ALL.filter((l) => {
    const r = store.record(l.id);
    return r && r.perfect;
  }).length;
  dom.totals.innerHTML = `已熄 <b>${solved}</b>/${ALL.length} · 最优 <b>${perfect}</b> · 累计按键 <b>${store.stats.presses}</b>`
    + ` · ${rows.map((r) => `${r.label}${r.lots}`).join(' ')}`;
}

function renderShelf() {
  const ids = campaignIds();
  const unlocked = store.unlocked;
  let html = '';
  for (const tier of TIERS) {
    const lots = lotsIn(tier.key);
    if (!lots.length) continue;
    html += `<p class="tier">${tier.label} · ${tier.blurb}</p>`;
    html += lots.map((l) => {
      const rec = store.record(l.id);
      const klass = [rec ? (rec.perfect ? 'perfect' : 'done') : '', state.lot && state.lot.id === l.id ? 'here' : '']
        .filter(Boolean).join(' ');
      const locked = ids.indexOf(l.id) >= unlocked;
      return `<button type="button" data-id="${l.id}" class="${klass}"${locked ? ' disabled' : ''}>${l.id.slice(-2)}</button>`;
    }).join('');
  }
  const doneToday = !!store.dailyDone(todayKey());
  html += '<p class="tier">每日</p>'
    + `<button type="button" data-route="/daily" class="${state.mode === 'daily' ? 'here' : ''}${doneToday ? ' perfect' : ''}">今日</button>`;
  dom.shelf.innerHTML = html;
}

function renderAbout() {
  const { lot } = state;
  const tier = tierByKey(lot.tier);
  dom.about.innerHTML = `「${tier.label}」这一档收录的 par 实测落在 <code>${tier.min}-${tier.max}</code> 之间，`
    + `这一关是 <code>${lot.par}</code>：由 <code>js/core/gf2.js</code> 在 <code>2^${lot.nullity}=${2 ** lot.nullity}</code> `
    + `个解里枚举出权重最小的那个。4×4 的每一个可解盘面还被 <code>js/core/solve.js</code> 的按键图广度优先搜索`
    + `全量复核过（65536 个盘面，像集 4096，0 处不一致）；5×5 太大，只做随机抽样。`
    + `盘上的数字是量出来的，不是估的。存档只在这台设备上：<code>${SAVE_KEY}</code>`
    + `（${store.persistent ? 'localStorage 可用' : 'localStorage 不可用，本次仅内存'}）。`;
}

function renderCurtain() {
  const { lot, game } = state;
  if (!game.done) {
    dom.curtain.hidden = true;
    return;
  }
  const g = grade(game);
  const rec = store.record(lot.id);
  const cells = answerOf(lot);
  dom.stars.innerHTML = starsMarkup(g.stars);
  dom.verdict.textContent = g.label;
  dom.tally.innerHTML = `你按了 <b>${game.presses}</b> 次，最少 <b>${lot.par}</b> 次<br>`
    + `最佳 <b>${rec ? rec.best : game.presses}</b> 次 · 第 <b>${rec ? rec.plays : 1}</b> 次通关`;
  dom.answer.innerHTML = `<p class="answer-label">认证答案 · ${lot.par} 按，顺序无关</p>`
    + `<div class="answer-grid" style="grid-template-columns:repeat(${lot.n}, 20px)">`
    + cellsOf(lot.n, 0n).map((_, i) => `<i class="${cells.includes(i) ? 'on' : ''}"></i>`).join('')
    + '</div>';
  dom.answer.hidden = true;
  dom.curtain.hidden = false;
}

// ---- the controls that are not the puzzle ----------------------------------

// 一次重开要复位的东西比看起来多：仿真时钟、粒子、余晖、暂停态、答案显示，以及
// 缓存下来的"这一关按过哪些键"。少复位任何一样，下一局都会带着上一局的残留。
function attemptReset({ countReset = true } = {}) {
  if (!state.game) return;
  if (countReset) store.noteReset();
  reset(state.game);
  state.showAnswer = false;
  setPaused(false);
  view.resetFx();
  clock.reset();
  hudSecond = -1;
  paint();
  clock.invalidate();
}

function setPaused(next) {
  const want = !!next;
  if (want === state.paused) return state.paused;
  state.paused = want;
  clock.setPaused(want);
  view.setPaused(want);
  if (want) audio.suspend();
  else audio.resume();
  paint();
  return state.paused;
}

function toggleMute() {
  const muted = audio.setMuted(!audio.isMuted());
  store.setSetting('muted', muted);
  syncButtons();
  if (!muted) audio.play('ui');
  return muted;
}

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

// 全屏按钮是 HUD 上真实存在的 #fullscreen；iOS Safari 没有元素级 requestFullscreen，
// 拿不到就退回"提示用户用系统手势"，而不是引用一个不存在的 id 假装按过了。
function toggleFullscreen() {
  const root = document.documentElement;
  if (fullscreenElement()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) return Promise.resolve(exit.call(document)).catch(() => {});
    return Promise.resolve();
  }
  const request = root.requestFullscreen || root.webkitRequestFullscreen || root.requestFullscreenWithOptions;
  if (!request) {
    dom.hintline.innerHTML = '<span class="answer-line">这个浏览器不支持网页全屏，请用系统的显示方式切换</span>';
    return Promise.resolve();
  }
  return Promise.resolve(request.call(root)).catch(() => {});
}

function openHelp() {
  state.helpOpen = true;
  dom.helpCard.hidden = false;
  setPaused(true);
  clock.invalidate();
}

function closeHelp() {
  state.helpOpen = false;
  dom.helpCard.hidden = true;
  store.setSetting('helpSeen', true);
}

function toggleHelp(force) {
  const want = force === undefined ? !state.helpOpen : !!force;
  if (want) openHelp();
  else closeHelp();
  return state.helpOpen;
}

function syncButtons() {
  const { game } = state;
  dom.undo.disabled = !game || game.back.length === 0 || game.done;
  dom.answerKey.textContent = state.showAnswer ? '收起答案' : '答案';
  dom.pause.textContent = state.paused ? '继续' : '暂停';
  dom.pause.setAttribute('aria-pressed', String(state.paused));
  dom.mute.textContent = audio.isMuted() ? '已静音' : '静音';
  dom.mute.setAttribute('aria-pressed', String(audio.isMuted()));
  for (const button of dom.modes.querySelectorAll('button')) {
    button.setAttribute('aria-current', String(button.dataset.mode === state.mode));
  }
  syncFullscreenLabel();
}

function syncFullscreenLabel() {
  if (!dom.fullscreen) return;
  const on = !!fullscreenElement();
  dom.fullscreen.textContent = on ? '退出全屏' : '全屏';
  dom.fullscreen.setAttribute('aria-pressed', String(on));
}

// ---- wiring ----------------------------------------------------------------

// 一套坐标换算，三种事件。pointerdown 是主路；不支持 pointer 事件的旧浏览器回落到
// touchstart / mousedown。两条路都必须先减掉 getBoundingClientRect()，否则手机上 CSS
// 缩放后的画布会点 A 打 B。
function bindCanvas() {
  const handle = (clientX, clientY) => {
    const rect = dom.canvas.getBoundingClientRect();
    const i = view.cellAt(clientX - rect.left, clientY - rect.top);
    if (i >= 0) pressKey(i);
  };
  if (window.PointerEvent) {
    dom.canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      handle(event.clientX, event.clientY);
    });
    return;
  }
  dom.canvas.addEventListener('touchstart', (event) => {
    if (!event.touches.length) return;
    event.preventDefault();
    handle(event.touches[0].clientX, event.touches[0].clientY);
  }, { passive: false });
  dom.canvas.addEventListener('mousedown', (event) => handle(event.clientX, event.clientY));
}

function bindKeys() {
  addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = event.target && event.target.tagName;
    // 焦点在按钮上时 Space/Enter 是浏览器原生的"按下这个按钮"，抢过来会变成一次点击
    // 加一次开局，所以这两个键只在焦点不在控件上时才归游戏。
    const onControl = tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA';
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === 'Escape') {
      if (state.helpOpen) { closeHelp(); setPaused(false); paint(); }
      return;
    }
    if (state.helpOpen) {
      if (key === 'Enter' || key === ' ' || key === 'h' || key === '?') {
        event.preventDefault();
        closeHelp();
        setPaused(false);
        paint();
      }
      return;
    }
    switch (key) {
      case 'p':
        event.preventDefault();
        setPaused(!state.paused);
        break;
      case 'r':
        event.preventDefault();
        attemptReset();
        break;
      case 'm':
        event.preventDefault();
        toggleMute();
        break;
      case 'f':
        event.preventDefault();
        toggleFullscreen();
        break;
      case 'h':
      case '?':
        event.preventDefault();
        toggleHelp(true);
        break;
      case 'Enter':
      case ' ':
        if (onControl) return;
        event.preventDefault();
        if (state.paused) setPaused(false);
        else if (state.game && state.game.done) startNext();
        else clock.invalidate();
        break;
      default:
        break;
    }
  });
}

function bind() {
  bindCanvas();
  bindKeys();
  for (const button of dom.modes.querySelectorAll('button')) {
    button.addEventListener('click', () => go(button.dataset.mode === 'daily' ? '#/daily' : '#/'));
  }
  dom.shelf.addEventListener('click', (event) => {
    const hit = event.target.closest('button');
    if (!hit || hit.disabled) return;
    if (hit.dataset.route) go(`#${hit.dataset.route}`);
    else if (hit.dataset.id) go(`#/lot/${hit.dataset.id}`);
  });
  dom.undo.addEventListener('click', stepBack);
  dom.answerKey.addEventListener('click', () => {
    state.showAnswer = !state.showAnswer;
    audio.play('ui');
    paint();
  });
  dom.restart.addEventListener('click', () => attemptReset());
  dom.pause.addEventListener('click', () => setPaused(!state.paused));
  dom.mute.addEventListener('click', toggleMute);
  dom.fullscreen.addEventListener('click', toggleFullscreen);
  dom.help.addEventListener('click', () => toggleHelp(true));
  dom.helpClose.addEventListener('click', () => { closeHelp(); setPaused(false); paint(); });
  dom.helpStart.addEventListener('click', () => { closeHelp(); setPaused(false); paint(); });
  dom.review.addEventListener('click', () => {
    dom.answer.hidden = !dom.answer.hidden;
  });
  dom.again.addEventListener('click', () => attemptReset({ countReset: false }));
  dom.next.addEventListener('click', startNext);
  dom.wipe.addEventListener('click', () => {
    store.reset();
    // 清完要读回来再说"清好了"：reset() 走的是同一条带守卫的路径，浏览器拒绝存储时它只
    // 能清掉本进程的内存，那时候"这台设备已忘记"是一句假话。
    const left = store.rawBytes();
    state.saveNote = left === null
      ? (store.persistent ? '存档已清空，这台设备回到第 1 关' : '这个浏览器不允许保存（隐身模式或以文件方式打开），刚才只清掉了本次会话')
      : `存档没清掉：盘上还剩 ${left.length} 字节`;
    audio.setMuted(false);
    paint();
  });
  addEventListener('hashchange', () => mount(routeFromLocation()));
  addEventListener('resize', () => { view.resize(); clock.invalidate(); });
  addEventListener('fullscreenchange', syncFullscreenLabel);
  addEventListener('webkitfullscreenchange', syncFullscreenLabel);
  // 切后台等于离开这件事：计时不该把"回邮件的两分钟"算进本关用时。
  addEventListener('visibilitychange', () => {
    if (document.hidden) {
      setPaused(true);
      audio.suspend();
    } else {
      audio.resume();
      clock.invalidate();
    }
  });
}

function drawBoard() {
  const { lot, game } = state;
  view.setBoard({
    n: lot.n,
    cells: boardCells(game),
    answer: answerOf(lot),
    // Before the win the overlay is the player's choice; after it the answer is simply shown.
    pressed: pressedOf(game),
    showAnswer: state.showAnswer || game.done,
    solved: game.done,
  });
}

function paint() {
  renderReadout();
  renderCrumbs();
  renderHint();
  renderTotals();
  renderShelf();
  renderAbout();
  renderCurtain();
  syncButtons();
  drawBoard();
}

// ---- the one action --------------------------------------------------------

function settle() {
  const { lot, game } = state;
  const rec = store.solve(lot.id, { presses: game.presses, par: lot.par, seconds: clock.stats().elapsed });
  const index = campaignIds().indexOf(lot.id);
  if (index >= 0) store.unlock(index + 2);
  if (state.mode === 'daily') store.markDaily(todayKey(), lot.id);
  audio.play('win');
  return rec;
}

function pressKey(j) {
  const { game } = state;
  if (!game || game.done) return false;
  // 暂停不是只把画面盖住：仿真、计时和输入在这一态下全部不推进。
  if (state.paused || state.helpOpen) {
    audio.play('deny');
    return false;
  }
  const before = boardCells(game);
  if (press(game, j) === null) return false;
  const after = boardCells(game);
  const changed = [];
  for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) changed.push(i);
  view.flash(changed, clock.stats().lastStamp);
  audio.play(after[j] ? 'press' : 'off');
  if (game.done) settle();
  paint();
  return true;
}

function stepBack() {
  if (!state.game || state.paused || state.helpOpen) return;
  if (!undo(state.game)) return;
  audio.play('ui');
  paint();
}

function startNext() {
  const ids = campaignIds();
  const here = state.mode === 'campaign' ? state.cursor : ids.indexOf(state.lot.id);
  state.cursor = here >= 0 ? Math.min(ids.length - 1, here + 1) : 0;
  go('#/');
}

// ---- mounting --------------------------------------------------------------

function renderMissing(id) {
  state.lot = null;
  state.game = null;
  state.missing = id;
  view.stop();
  dom.curtain.hidden = true;
  dom.readout.innerHTML = '';
  dom.totals.innerHTML = '';
  dom.shelf.innerHTML = '';
  dom.about.textContent = '';
  dom.crumbs.innerHTML = `找不到这一关<b>${id}</b><span class="band">曲库里没有这个 id</span>`;
  dom.hintline.innerHTML = '回到关卡列表：点左上角「关卡」。';
  syncButtons();
}

function mount(route) {
  const hash = location.hash;
  state.missing = null;
  if (route.mode === 'single') {
    const lot = byId(route.id);
    if (!lot) return renderMissing(route.id);
    state.mode = 'single';
    return loadLot(lot);
  }
  if (route.mode === 'daily') {
    state.mode = 'daily';
    return loadLot(byId(dailyId()));
  }
  if (route.mode !== 'campaign') return renderMissing(route.hash || hash);
  state.mode = 'campaign';
  const lot = levelAt(state.cursor);
  return loadLot(lot);
}

function go(hash) {
  if (location.hash === hash) mount(routeFromLocation());
  else location.hash = hash;
}

// A handle for tools/playtest.mjs, the browser assertions and the frame-rate harness: enough to
// drive a puzzle and read the board back. The browser assertions never go through here to decide
// what is true — presses come from real mouse events, and the difficulty numbers come from the
// baked file. This reports state and route.
window.lights = {
  version: 2,
  state,
  view,
  dom,
  store,
  hashSeed,
  todayKey,
  pool: () => ({ lots: ALL.length, tiers: TIERS.length, rows: summaryTable() }),
  route: routeFromLocation,
  go,
  mount,
  press: pressKey,
  play: (list) => list.map((j) => pressKey(j)),
  undo: stepBack,
  reset: () => attemptReset({ countReset: false }),
  restart: () => attemptReset(),
  pause: setPaused,
  mute: toggleMute,
  fullscreen: toggleFullscreen,
  help: toggleHelp,
  clock,
  audio: () => audio.status(),
  layout: () => view.layout(),
  cellCenter: (i) => view.cellCenter(i),
  cellRect: (i) => view.cellRect(i),
  cellAt: (x, y) => view.cellAt(x, y),
  boardCells: () => (state.game ? boardCells(state.game) : null),
  puzzleCells: () => (state.lot ? cellsOf(state.lot.n, state.lot.board) : null),
  pressedCells: () => (state.game ? pressedOf(state.game) : null),
  answerOf: (id) => {
    const lot = id ? byId(id) : state.lot;
    return lot ? { par: lot.par, n: lot.n, keys: lot.keys, cells: answerOf(lot) } : null;
  },
  summary: () => ({
    mode: state.mode,
    id: state.lot ? state.lot.id : null,
    n: state.lot ? state.lot.n : null,
    par: state.lot ? state.lot.par : null,
    presses: state.game ? state.game.presses : null,
    lit: state.game ? litCount(state.game) : null,
    done: state.game ? state.game.done : null,
    cursor: state.cursor,
    missing: state.missing,
    paused: state.paused,
    helpOpen: state.helpOpen,
    muted: audio.isMuted(),
    seconds: clock.stats().elapsed,
    frames: clock.stats().frames,
    fx: view.debug(),
    audio: audio.status(),
    unlocked: store.unlocked,
    plays: store.stats.solves,
    totals: dom.totals.textContent,
    hint: dom.hintline.textContent,
    crumbs: dom.crumbs.textContent,
    curtain: !dom.curtain.hidden,
  }),
};

bind();
view.start();
// 静音偏好跟着设备走，教学只在第一次弹：一个已经知道自己要什么的玩家不该每次开
// 都要多点一下"知道了"。
audio.setMuted(!!store.settings.muted);
mount(routeFromLocation());
if (!store.settings.helpSeen) toggleHelp(true);
clock.start();
