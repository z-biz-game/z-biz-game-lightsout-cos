// 唯一的帧循环与唯一的时钟。
//
// 为什么单独一个文件：这个游戏的"仿真"只有一件事在随时间推进——本关用时、灯灭的余晖和
// 按键火花粒子。三件事都必须满足两条：暂停期间不推进，以及 30/60/120Hz 下跑同样的虚拟
// 时长得到同样的结果。所以时间只在这里读一次（rAF 的 timestamp，不读 performance.now），
// 往下只传 dt；任何模块想要时间，问 clock，不要自己 now()。
//
// 两条刻意的取舍：
//   1. dt 上限 50ms。切后台回来会带着几秒的 elapsed，不夹住的话粒子会瞬移出屏、
//      定步长累加器一帧跑几百步。谜题游戏不需要补那段"消失的时间"。
//   2. 空闲时自动停。没有动画需求且计时已停（已通关/暂停/缺盘面）时循环整个停下来，
//      一个回合制点灯谜不该让 rAF 空转烧电；invalidate() 负责把它再叫醒。

const MAX_DT = 0.05;

export function createClock({ onFrame, shouldRun } = {}) {
  let raf = null;
  let last = 0;
  let elapsed = 0;
  let frames = 0;
  let paused = false;
  let running = false;

  function stop() {
    running = false;
    if (raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
  }

  // 从 1000ms 起步而不是 0：last === 0 会被当成"还没收过帧"的哨兵，凭空吃掉一帧、
  // 造出一个 25ms 的假帧率依赖（本仓帧率对拍实测踩过）。
  function seed(ts) {
    last = ts || 1000;
  }

  function tick(ts) {
    raf = null;
    const stamp = typeof ts === 'number' && ts > 0 ? ts : last + 16.666;
    let dt = (stamp - last) / 1000;
    last = stamp;
    if (!(dt > 0)) dt = 0;
    if (dt > MAX_DT) dt = MAX_DT;
    frames += 1;
    if (!paused) elapsed += dt;
    if (onFrame) onFrame(paused ? 0 : dt, stamp, elapsed);
    if (running && (shouldRun ? shouldRun() : true)) {
      raf = requestAnimationFrame(tick);
    } else {
      stop();
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      seed(typeof performance === 'undefined' ? 0 : performance.now());
      raf = requestAnimationFrame(tick);
    },
    stop,
    invalidate() {
      if (!running) this.start();
    },
    // 暂停 = 时钟不推进 + 帧回调拿到 dt=0。画面照画一帧（要出那层暂停遮罩），
    // 但用时、余晖、粒子全部冻住；恢复后不补中间那段虚拟时间。
    setPaused(next) {
      const changed = paused !== !!next;
      paused = !!next;
      if (changed) this.invalidate();
      return paused;
    },
    isPaused: () => paused,
    reset() {
      elapsed = 0;
      frames = 0;
      seed(typeof performance === 'undefined' ? 0 : performance.now());
      this.invalidate();
    },
    // 供测试与探针读取：虚拟秒与帧数分开，才能分辨"随帧数动"和"随时长动"。
    stats: () => ({ elapsed, frames, paused, running, lastStamp: last }),
    advance(dtSeconds) {
      tick((last || 1000) + dtSeconds * 1000);
    },
  };
}
