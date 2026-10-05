// 音效。五个声音（press / off / win / deny / ui），全部现场合成，不带一个音频文件。
//
// 静音是真静音：setMuted(true) 会 `suspend()` 掉 AudioContext，并且此后**一个振荡器节点
// 都不再新建**。只把 master gain 设成 0 的那种做法不算静音——节点照样在建、上下文照样在
// 跑，DevTools 里看得见音频活动，耗电也照旧。这里把新建节点数记在 `nodes` 上，
// 静音态下按一百次键它也必须不动，这条是可以被 harness 直接复验的（window.lights.audio()）。
//
// 上下文只在第一次真实手势里建：Chrome 的自动播放策略下提前建会拿到一个 suspended
// 的上下文，然后所有声音静默失败，玩家只会以为"这游戏没声音"。
let Ctor = null;
try {
  Ctor = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
} catch (err) {
  Ctor = null;
}

const VOICES = {
  press: { freq: 523.25, type: 'triangle', dur: 0.10, gain: 0.16 },
  off: { freq: 349.23, type: 'triangle', dur: 0.09, gain: 0.12 },
  win: { freq: 659.25, type: 'sine', dur: 0.42, gain: 0.20, arpeggio: [659.25, 830.61, 987.77, 1318.51] },
  deny: { freq: 130.81, type: 'sawtooth', dur: 0.14, gain: 0.09 },
  ui: { freq: 880, type: 'square', dur: 0.045, gain: 0.05 },
};

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let nodes = 0;
  let suspends = 0;
  let resumes = 0;
  // 无音频环境（node 测试、老浏览器、被策略拒绝）时整套降级成 no-op，而不是抛错：
  // 声音是这个游戏的装饰，缺它不影响"最少按键数是量出来的"这件事。
  let broken = !Ctor;

  function ensure() {
    if (broken || ctx) return ctx;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    } catch (err) {
      broken = true;
      ctx = null;
    }
    return ctx;
  }

  function blip(freq, type, dur, gain, at) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    nodes += 1;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(env);
    env.connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  function play(name) {
    if (muted || broken) return false;
    const c = ensure();
    if (!c) return false;
    if (c.state === 'suspended') {
      // 上一次静音留下的 suspended 上下文：先恢复再出声，否则第一个音会静默丢掉。
      c.resume().catch(() => {});
      resumes += 1;
    }
    const v = VOICES[name] || VOICES.ui;
    const at = c.currentTime + 0.001;
    if (v.arpeggio) {
      // 通关音是一串上行分解和弦：这是本仓唯一"庆祝"的时刻，值得四个音。
      v.arpeggio.forEach((f, i) => blip(f, v.type, v.dur / 1.6, v.gain, at + i * 0.075));
    } else {
      blip(v.freq, v.type, v.dur, v.gain, at);
    }
    return true;
  }

  return {
    play,
    // 静音切换同时负责上下文的挂起与恢复：muted 为真时 play() 直接返回，一个节点都不建。
    setMuted(next) {
      const want = !!next;
      if (want === muted) return muted;
      muted = want;
      if (muted) {
        if (ctx && ctx.state === 'running') {
          suspends += 1;
          ctx.suspend().catch(() => {});
        }
      } else if (ctx) {
        resumes += 1;
        ctx.resume().catch(() => {});
      }
      return muted;
    },
    isMuted: () => muted,
    // 切后台/暂停时把上下文挂起，回来再续：不留一个还在跑的音频线程。
    suspend() {
      if (ctx && ctx.state === 'running') {
        suspends += 1;
        return ctx.suspend().catch(() => {});
      }
      return Promise.resolve();
    },
    resume() {
      if (!muted && ctx && ctx.state === 'suspended') {
        resumes += 1;
        return ctx.resume().catch(() => {});
      }
      return Promise.resolve();
    },
    status: () => ({
      hasContext: !!Ctor,
      broken,
      muted,
      nodes,
      suspends,
      resumes,
      state: ctx ? ctx.state : 'none',
    }),
  };
}
