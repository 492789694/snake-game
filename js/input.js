// ===== 输入层：指针 / 拧转 / 摇一摇 / 键盘 → 搓动信号 =====
// 所有输入源统一输出 { v: 搓动强度 0..1, dir: ±1 本次搓动方向 }，
// 由输入总线汇总后驱动物理模拟。核心检测器均为纯函数，便于自动测试。

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * 通用“往复搓动”检测器：
 * 跟踪一维坐标 x 的时间序列，估计瞬时速度 |v| 与往复振荡频率（换向次数），
 * 输出 强度 = 速度归一化 × (0.3 + 0.7×振荡因子)。
 * 只朝一个方向匀速拖动时振荡因子低 → 强度被压低；快速来回搓 → 强度高。
 */
export function createRubDetector(vMax = 1) {
  let prev = null, lastT = 0, emaV = 0, dir = 1;
  let history = [];   // {t, s} s=±1 速度方向
  return function feed(x, t) {
    if (prev !== null && t > lastT) {
      const dt = t - lastT;
      const v = (x - prev) / dt;
      const a = Math.min(1, dt / 0.09);
      emaV += (Math.abs(v) - emaV) * a;
      const s = v === 0 ? 0 : (v > 0 ? 1 : -1);
      if (s !== 0) {
        history.push({ t, s });
        while (history.length && t - history[0].t > 0.65) history.shift();
        let changes = 0;
        for (let i = 1; i < history.length; i++) if (history[i].s !== history[i - 1].s) changes++;
        const osc = clamp01(changes / 3);
        const vRaw = clamp01(emaV / vMax) * (0.3 + 0.7 * osc);
        if (v !== 0) dir = s;
        prev = x; lastT = t;
        return { v: vRaw, dir };
      }
      prev = x; lastT = t;
      return { v: 0, dir };
    }
    prev = x; lastT = t;
    return { v: 0, dir };
  };
}

/** 双指“拧转”检测器：跟踪两指连线角度，输出角速度 → 搓动信号 */
export function createTwistDetector(vMax = 7) {
  let prevA = null, lastT = 0, emaV = 0, dir = 1;
  return function feed(angle, t) {
    if (prevA !== null && t > lastT) {
      let d = angle - prevA;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const dt = t - lastT;
      const v = d / dt;
      const a = Math.min(1, dt / 0.08);
      emaV += (Math.abs(v) - emaV) * a;
      if (v !== 0) dir = v > 0 ? 1 : -1;
      prevA = angle; lastT = t;
      return { v: clamp01(emaV / vMax), dir };
    }
    prevA = angle; lastT = t;
    return { v: 0, dir };
  };
}

/** 摇一摇检测器：加速度去重力后取能量，超阈值映射为搓动强度 */
export function createShakeDetector() {
  let gx = 0, gy = 0, gz = 9.81, emaE = 0, dir = 1;
  let lastT = 0;
  return function feed(ax, ay, az, t) {
    if (!lastT) { lastT = t; return { v: 0, dir }; }
    const dt = Math.min(t - lastT, 0.1);
    lastT = t;
    const alpha = Math.min(1, dt / 0.045);       // 重力分量低通
    gx += (ax - gx) * alpha * 0.55;
    gy += (ay - gy) * alpha * 0.55;
    gz += (az - gz) * alpha * 0.55;
    const hx = ax - gx, hy = ay - gy, hz = az - gz;
    const e = hx * hx + hy * hy + hz * hz;
    const beta = Math.min(1, dt / 0.05);          // 能量快衰减 → 每次摇晃都是脉冲
    emaE += (e - emaE) * beta;
    const mag = Math.sqrt(emaE);
    const v = clamp01((mag - 4.5) / 26);
    if (v > 0.12) {
      let m = hx, s = 1;
      if (Math.abs(hy) > Math.abs(m)) { m = hy; s = 2; }
      if (Math.abs(hz) > Math.abs(m)) { m = hz; s = 3; }
      dir = m >= 0 ? 1 : -1;
    }
    return { v, dir };
  };
}

/** 输入总线：汇总各输入源，取最强源为当前信号并做平滑 */
export function createInputBus() {
  const sources = new Map();
  let v = 0, dir = 1;
  return {
    report(id, sv, sdir) {
      sources.set(id, { v: sv, dir: sdir >= 0 ? 1 : -1, t: performance.now() });
    },
    read() {
      const now = performance.now();
      let best = null;
      for (const [id, s] of sources) {
        if (now - s.t > 180) { sources.delete(id); continue; }
        if (!best || s.v > best.v) best = s;
      }
      let vin = 0;
      if (best) { vin = Math.min(best.v, 1.2); dir = best.dir; }
      v += (vin - v) * 0.35;                        // 平滑衔接
      if (vin > 0.03 && v < 0.02) v = vin * 0.5;    // 快速起振
      return { v: v > 0.015 ? v : 0, dir };
    },
    reset() { sources.clear(); v = 0; },
  };
}

/** 键盘自动搓动信号（按住空格/方向键时由 main 调用） */
export function keyboardRub(simT, hold) {
  if (!hold) return { v: 0, dir: 1 };
  const dir = Math.sin(simT * Math.PI * 2 * 2.8) >= 0 ? 1 : -1;   // 2.8 Hz 往返
  return { v: 0.62, dir };
}
