// ===== UI 层：仪表盘 / 计分 / 里程碑 / 挑战 / 特效 =====
import { MILESTONES, CHALLENGES } from './game.js';

const $ = (id) => document.getElementById(id);

export function initUI() {
  const el = {
    score: $('score'), bestLine: $('bestLine'),
    milestones: $('milestones'), challenges: $('challenges'),
    rpmVal: $('rpmVal'), hzVal: $('hzVal'),
    gaugeArc: $('gaugeArcFill'), gaugeNeedle: $('gaugeNeedle'), gaugeTicks: $('gaugeTicks'),
    fft: $('fft'),
    combo: $('combo'), comboTime: $('comboTime'), mult: $('mult'),
    modeChip: $('modeChip'),
    hint: $('hint'),
    toasts: $('toasts'), confetti: $('confetti'), flash: $('flash'),
    helpModal: $('helpModal'),
    handBox: $('handBox'), handStatus: $('handStatus'),
    btnCam: $('btnCam'), btnShake: $('btnShake'), btnSound: $('btnSound'), btnHelp: $('btnHelp'),
  };

  const fftCtx = el.fft.getContext('2d');
  let dispRpm = 0;
  let lastActivity = -10;
  let hintShown = true;
  const SVGNS = 'http://www.w3.org/2000/svg';

  // 里程碑列表
  for (const m of MILESTONES) {
    const li = document.createElement('li');
    li.dataset.rpm = m.rpm;
    li.innerHTML = `<span>${m.rpm} · ${m.name}</span><span class="b">+${m.bonus}</span>`;
    el.milestones.appendChild(li);
  }

  // 挑战卡片
  for (const c of CHALLENGES) {
    const div = document.createElement('div');
    div.className = 'chal';
    div.dataset.id = c.id;
    div.innerHTML = `
      <div class="c-head"><b>${c.name}</b><span>${c.desc}</span></div>
      <div class="bar"><i></i></div>
      <div class="c-reward">奖励 +${c.bonus} 分</div>`;
    el.challenges.appendChild(div);
  }

  // 表盘刻度
  for (let rpm = 0; rpm <= 1500; rpm += 150) {
    const ang = (-90 + (rpm / 1500) * 180) * Math.PI / 180;
    const r1 = rpm % 750 === 0 ? 88 : 82, r2 = 70;
    const line = document.createElementNS(SVGNS, 'line');
    line.setAttribute('x1', 110 + Math.cos(ang) * r1);
    line.setAttribute('y1', 115 + Math.sin(ang) * r1);
    line.setAttribute('x2', 110 + Math.cos(ang) * r2);
    line.setAttribute('y2', 115 + Math.sin(ang) * r2);
    line.setAttribute('stroke', 'rgba(107,74,31,0.5)');
    line.setAttribute('stroke-width', rpm % 750 === 0 ? 2 : 1);
    el.gaugeTicks.appendChild(line);
  }

  /* ---------- 特效 ---------- */
  let toastQueue = [];
  function showToast(text, big = false, delay = 0) {
    toastQueue.push({ text, big, at: performance.now() + delay });
    if (toastQueue.length === 1) pumpToasts();
  }
  function pumpToasts() {
    if (!toastQueue.length) return;
    const t = toastQueue.shift();
    const d = document.createElement('div');
    d.className = 'toast' + (t.big ? ' big' : '');
    d.textContent = t.text;
    el.toasts.appendChild(d);
    setTimeout(() => d.remove(), 2700);
    if (toastQueue.length) setTimeout(pumpToasts, 380);
  }

  const CONF_COLORS = ['#e0b93e', '#c94f2f', '#3f8f4f', '#d8a522', '#b0762c', '#7c9f52'];
  function confetti(n = 46) {
    for (let i = 0; i < n; i++) {
      const c = document.createElement('div');
      c.className = 'conf';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = CONF_COLORS[(Math.random() * CONF_COLORS.length) | 0];
      c.style.setProperty('--dur', (0.9 + Math.random() * 0.9) + 's');
      c.style.setProperty('--delay', (Math.random() * 0.5) + 's');
      c.style.setProperty('--drop', (60 + Math.random() * 45) + 'vh');
      c.style.setProperty('--rot', ((Math.random() - 0.5) * 1440) + 'deg');
      el.confetti.appendChild(c);
      setTimeout(() => c.remove(), 2200);
    }
  }
  function flash() {
    el.flash.classList.remove('hidden');
    setTimeout(() => el.flash.classList.add('hidden'), 720);
  }

  /* ---------- 事件 → 展示 ---------- */
  function onEvents(events) {
    for (const e of events) {
      if (e.type === 'milestone') {
        showToast(`🎉 达成「${e.name}」${e.rpm} RPM  +${e.bonus} 分`, true, 0);
        confetti(); flash();
        const li = el.milestones.querySelector(`li[data-rpm="${e.rpm}"]`);
        if (li) { li.classList.add('done'); li.classList.remove('now'); }
      } else if (e.type === 'challenge') {
        showToast(`🏆 挑战完成「${e.name}」 +${e.bonus} 分！`, true, 300);
        confetti(60); flash();
        const ch = el.challenges.querySelector(`.chal[data-id="${e.id}"]`);
        if (ch) ch.classList.add('done');
      } else if (e.type === 'comboUp') {
        showToast(`🔥 连鸣倍率 ×${e.mult}`, false, 0);
      }
    }
  }

  /* ---------- 每帧刷新 ---------- */
  function update(sim, gameSt, synth, input) {
    const rpm = Math.abs(sim.omega) * 60 / (2 * Math.PI);
    dispRpm += (rpm - dispRpm) * 0.22;

    // 表盘
    const frac = Math.min(1, dispRpm / 1500);
    el.gaugeArc.setAttribute('stroke-dashoffset', (282.75 * (1 - frac)).toFixed(1));
    el.gaugeNeedle.setAttribute('transform', `rotate(${(-90 + frac * 180).toFixed(1)} 110 115)`);
    el.rpmVal.textContent = Math.round(dispRpm);

    // 音高显示（来自音频合成参数，音频未启动前显示 —）
    if (synth && synth.ready && synth.cur) {
      const f = synth.cur.f0;
      el.hzVal.textContent = f < 60 ? '音高 — Hz' : `音高 ${Math.round(f)} Hz`;
    } else {
      el.hzVal.textContent = '音高 — Hz';
    }

    // 得分
    el.score.textContent = Math.floor(gameSt.score);
    el.bestLine.textContent =
      `🏆 最高分 ${Math.floor(gameSt.best.score)} · 最高转速 ${Math.floor(gameSt.best.rpm)} RPM · 连鸣 ${gameSt.best.streak}s`;

    // 里程碑高亮当前档位
    let cur = 0;
    for (const m of MILESTONES) if (rpm >= m.rpm) cur = m.rpm;
    for (const li of el.milestones.children) {
      if (li.classList.contains('done')) continue;
      li.classList.toggle('now', cur === Number(li.dataset.rpm));
    }

    // 挑战进度
    const c1 = gameSt.chals[0], c2 = gameSt.chals[1];
    const bar1 = el.challenges.querySelector('.chal[data-id="rush"] .bar i');
    const bar2 = el.challenges.querySelector('.chal[data-id="streak"] .bar i');
    bar1.style.width = Math.min(100, (gameSt.rpmMax / c1.goal) * 100) + '%';
    bar2.style.width = Math.min(100, (gameSt.streak / c2.goal) * 100) + '%';

    // 连鸣
    const buzzing = rpm >= 60;
    if (buzzing) {
      el.combo.classList.remove('hidden');
      el.comboTime.textContent = gameSt.comboTime.toFixed(1);
      el.mult.textContent = '×' + gameSt.mult;
    } else if (gameSt.comboTime === 0) {
      el.combo.classList.add('hidden');
    } else {
      el.combo.classList.remove('hidden');
      el.comboTime.textContent = gameSt.comboTime.toFixed(1);
    }

    // FFT 频谱条
    drawFFT(synth);

    // 提示淡出
    if (input.v > 0.08) {
      lastActivity = sim.t;
      if (hintShown) { hintShown = false; el.hint.classList.add('fade'); }
    }
    if (!hintShown && sim.t - lastActivity > 14) {
      hintShown = true;
      el.hint.classList.remove('fade');
    }
  }

  function drawFFT(synth) {
    const W = el.fft.width, H = el.fft.height;
    fftCtx.clearRect(0, 0, W, H);
    fftCtx.fillStyle = 'rgba(90,72,34,0.08)';
    fftCtx.fillRect(0, 0, W, H);
    if (!synth || !synth.ready || !synth.analyser) return;
    const data = new Uint8Array(synth.analyser.frequencyBinCount);
    synth.analyser.getByteFrequencyData(data);
    const N = 22;
    const bw = W / N;
    for (let i = 0; i < N; i++) {
      const idx = Math.floor(Math.pow(i / N, 1.6) * data.length * 0.7);
      const v = (data[idx] || 0) / 255;
      const h = Math.max(1.5, v * (H - 6));
      const hue = 90 - v * 90;   // 绿→红
      fftCtx.fillStyle = `hsl(${hue}, 70%, ${38 + v * 14}%)`;
      fftCtx.fillRect(i * bw + 1.5, H - h, bw - 3, h);
    }
  }

  /* ---------- 状态按钮 ---------- */
  function setSoundOn(on) {
    el.btnSound.classList.toggle('on', on);
    el.btnSound.classList.toggle('off', !on);
    el.btnSound.textContent = on ? '🔊' : '🔇';
  }
  function setCamActive(active) {
    el.btnCam.classList.toggle('on', active);
    el.btnCam.classList.toggle('off', !active);
  }
  function setShakeActive(active) {
    el.btnShake.classList.toggle('on', active);
    el.btnShake.classList.toggle('off', !active);
  }
  function setHandStatus(cls) {
    el.handStatus.className = 'dot ' + cls;
  }
  function setHandVisible(show) {
    el.handBox.classList.toggle('hidden', !show);
  }
  function setMode(viewMode) {
    el.modeChip.textContent = viewMode ? '🔭 视角模式 · 双击切换搓动' : '🖐 搓动模式 · 双击切换视角';
    el.modeChip.classList.toggle('view', viewMode);
  }

  return {
    el, update, onEvents,
    showToast, confetti, flash,
    setSoundOn, setCamActive, setShakeActive, setHandStatus, setHandVisible, setMode,
  };
}
