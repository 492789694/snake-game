// ===== 挑战玩法与纪录（纯逻辑，无 DOM 依赖，便于测试） =====
import { rpmOf } from './physics.js';

export const BUZZ_ON = 6;   // 起鸣角速度 rad/s（≈57 RPM）
export const BUZZ_RPM = 60; // 计分起转 RPM

export const MILESTONES = [
  { rpm: 120,  name: '初鸣',     bonus: 200 },
  { rpm: 300,  name: '蝉声渐起', bonus: 400 },
  { rpm: 600,  name: '烈日蝉鸣', bonus: 800 },
  { rpm: 900,  name: '群蝉齐鸣', bonus: 1200 },
  { rpm: 1200, name: '震翅狂鸣', bonus: 1600 },
  { rpm: 1500, name: '竹蝉之王', bonus: 2500 },
];

export const CHALLENGES = [
  { id: 'rush',   name: '直上青云', desc: '冲上 900 RPM',    goal: 900, bonus: 1500, unit: 'rpm' },
  { id: 'streak', name: '蝉鸣不歇', desc: '连续鸣叫 20 秒',  goal: 20,  bonus: 1500, unit: 's' },
];

const KEY = 'zhiziliao_best_v1';
export function loadBest() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const o = JSON.parse(raw);
        return { score: o.score || 0, rpm: o.rpm || 0, streak: o.streak || 0 };
      }
    }
  } catch (e) { /* 隐私模式等 */ }
  return { score: 0, rpm: 0, streak: 0 };
}
export function saveBest(b) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(b));
  } catch (e) { /* 忽略 */ }
}

export function createGame() {
  const st = {
    score: 0,          // 本局得分
    mult: 1,           // 连鸣倍率
    comboTime: 0,      // 当前连续鸣叫时长 s
    streak: 0,         // 本次连鸣持续 s（断鸣>1.5s 重置）
    streakBest: 0,     // 本局最长连鸣
    lastBuzz: -10,     // 最近一次鸣叫时间
    rpmMax: 0,         // 本局最高转速
    miles: MILESTONES.map((m) => ({ ...m, done: false })),
    chals: CHALLENGES.map((c) => ({ ...c, done: false })),
    events: [],        // 本帧事件队列
    best: loadBest(),
  };

  function update(sim, dt) {
    st.events.length = 0;
    const rpm = rpmOf(sim.omega);
    const buzzing = rpm >= BUZZ_RPM && Math.abs(sim.omega) >= BUZZ_ON;
    const now = sim.t;

    if (rpm > st.rpmMax) st.rpmMax = rpm;

    if (buzzing) {
      if (now - st.lastBuzz > 1.5) st.streak = 0;   // 重新起鸣
      st.comboTime += dt;
      st.streak += dt;
      const newMult = Math.min(8, 1 + Math.floor(st.comboTime / 4));
      if (newMult > st.mult) {
        st.mult = newMult;
        st.events.push({ type: 'comboUp', mult: newMult });
      }
      st.score += (rpm / 45) * st.mult * dt;       // 转速越快得分越快
      if (st.streak > st.streakBest) st.streakBest = st.streak;
      st.lastBuzz = now;
    } else if (now - st.lastBuzz > 1.5 && st.comboTime > 0) {
      st.comboTime = 0;
      st.mult = 1;                                  // 断鸣重置倍率
    }

    for (const m of st.miles) {
      if (!m.done && st.rpmMax >= m.rpm) {
        m.done = true;
        st.score += m.bonus;
        st.events.push({ type: 'milestone', rpm: m.rpm, name: m.name, bonus: m.bonus });
      }
    }
    const c1 = st.chals[0];
    if (!c1.done && st.rpmMax >= c1.goal) {
      c1.done = true;
      st.score += c1.bonus;
      st.events.push({ type: 'challenge', id: c1.id, name: c1.name, bonus: c1.bonus });
    }
    const c2 = st.chals[1];
    if (!c2.done && st.streak >= c2.goal) {
      c2.done = true;
      st.score += c2.bonus;
      st.events.push({ type: 'challenge', id: c2.id, name: c2.name, bonus: c2.bonus });
    }
    return st;
  }

  /** 会话结束/定期：写入最高纪录 */
  function persist() {
    const b = loadBest();
    const merged = {
      score: Math.max(b.score, Math.floor(st.score)),
      rpm: Math.max(b.rpm, Math.floor(st.rpmMax)),
      streak: Math.max(b.streak, Math.round(st.streakBest * 10) / 10),
    };
    st.best = merged;
    saveBest(merged);
    return merged;
  }

  return { st, update, persist };
}
