// ===== 竹知了 · 旋转物理模型 =====
// 简化自真实玩具动力学：
//  1) 搓动竹柄 → 棉线绞紧 → 竹筒绕线轴获得角速度 ω（飞轮模型）
//  2) 停止搓动后：空气阻力（∝ω²）+ 棉线/轴承摩擦（∝ω）让转速自然衰减
//  3) 转速快时离心力把竹筒甩起（锥摆），转速慢时自然垂下来摇摆
// 所有常量集中于此，便于调参。

export const P = {
  omegaMax: 165,          // 最大转速目标 rad/s（≈1575 RPM，留裕量给 1500 RPM 里程碑）
  tauDrive: 0.10,         // 搓动时转速追随目标的时间常数 s
  torque: 42,             // 每下搓动附加力矩 rad/s²（换向更干脆）
  kDrag2: 0.0035,         // 空气阻力系数（二次项）
  kDrag1: 0.25,           // 棉线摩擦系数（一次项）
  g: 9.81,                // 重力加速度 m/s²
  L: 0.52,                // 棉线长度 m
  kTheta: 30,             // 摆角回复刚度
  cTheta: 3.6,            // 摆动阻尼（稍欠阻尼，甩起时会轻轻晃动）
  whirlCap: Math.PI * 4,  // 环绕（锥摆）角速度视觉上限 rad/s
};

export const rpmOf = (omega) => Math.abs(omega) * 60 / (2 * Math.PI);
export const revOf = (omega) => Math.abs(omega) / (2 * Math.PI);

/** 创建模拟状态 */
export function createSim() {
  return {
    omega: 0,        // 自转角速度 rad/s（有符号，方向随搓动方向切换）
    spin: 0,         // 累计自转角（渲染残影用）
    theta: 0.05,     // 竹筒偏离竖直悬挂方向的角度 rad（0=自然下垂）
    thetaDot: 0,
    phi: 0,          // 锥摆平面方位角 rad
    t: 0,            // 模拟累计时间 s
  };
}

/**
 * 推进一帧物理
 * @param {object} sim   模拟状态
 * @param {{v:number, dir:number}} input  v∈[0,1.25] 搓动强度, dir=±1 本次搓动方向
 * @param {number} dt    帧间隔 s（内部截断到 50ms，防跳帧）
 */
export function stepSim(sim, input, dt) {
  dt = Math.min(Math.max(dt, 1e-4), 0.05);
  const v = input.v > 0 ? Math.min(input.v, 1.25) : 0;
  const dir = input.dir >= 0 ? 1 : -1;

  // 搓动驱动：转速向目标收敛 + 每帧持续力矩
  // 真实玩具中棉线会打滑：搓动方向与当前自转方向一致 → 强耦合驱动；
  // 反向搓动 → 线打滑，只给微弱反向力矩（竹筒保持原方向旋转，蝉鸣不断）
  const target = dir * v * P.omegaMax;
  const s = Math.abs(sim.omega) < 0.5 ? dir : (sim.omega >= 0 ? 1 : -1);
  const aligned = dir === s;
  const drive = v > 0.02
    ? (aligned
        ? (target - sim.omega) * Math.min(1, dt / P.tauDrive) + dir * v * P.torque * dt
        : dir * v * P.torque * 0.18 * dt)
    : 0;

  // 阻力：空气阻力 ∝ ω²（高速主导）+ 线摩擦 ∝ ω（低速尾巴）
  const drag = -(P.kDrag2 * sim.omega * Math.abs(sim.omega) + P.kDrag1 * sim.omega) * dt;

  sim.omega += drive + drag;
  if (v < 0.02 && Math.abs(sim.omega) < 0.03) sim.omega = 0;

  // 累计自转角（取模防止长时间运行精度丢失）
  sim.spin = (sim.spin + sim.omega * dt) % (Math.PI * 2);

  // 锥摆：离心力与重力平衡角 θ_eq = acos(g/(L·Ω²))
  const Omega = Math.abs(sim.omega);
  const lift = P.L * Omega * Omega;
  const thetaEq = lift > P.g ? Math.acos(Math.min(1, P.g / lift)) : 0;
  sim.thetaDot += (-(sim.theta - thetaEq) * P.kTheta - sim.thetaDot * P.cTheta) * dt;
  sim.theta += sim.thetaDot * dt;

  // 静止悬挂时轻微晃动（风/手抖）
  if (Omega < 4) sim.thetaDot += (Math.random() - 0.5) * 0.9 * dt;
  if (thetaEq === 0 && sim.theta < 0.001 && sim.thetaDot < 0) sim.thetaDot = 0;

  // 锥摆平面绕竖直轴旋转：转速越快、甩得越开，绕得越快
  sim.phi += Math.min(Omega, P.whirlCap) * Math.min(1, sim.theta / 0.55) * dt;

  sim.t += dt;
  return sim;
}
