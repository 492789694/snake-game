// ===== 竹知了 · 主装配 =====
// 场景 + 物理 + 声音 + 输入 + 挑战 + UI 的主循环。

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createScene } from './scene.js';
import { createSim, stepSim } from './physics.js';
import { CicadaSynth } from './audio.js';
import { createInputBus, createRubDetector, createTwistDetector, createShakeDetector, keyboardRub } from './input.js';
import { createGame } from './game.js';
import { initUI } from './ui.js';
import { startHandCamera } from './gesture.js';

const $ = (id) => document.getElementById(id);
const canvas = $('gl');
const qs = new URLSearchParams(location.search);
const DEMO = qs.has('demo');
const NOAUDIO = qs.has('noaudio');   // 无音频环境/自动测试：跳过 AudioContext
const LOWRES = qs.has('lowres');     // 低负载渲染（自动测试用）
const NORENDER = qs.has('norender'); // 跳过渲染（事件链路自动测试用）
const TIMERTICK = qs.has('timertick'); // 定时器驱动主循环（无头虚拟时间测试用）

/* ---------- 全局错误提示 ---------- */
function err(msg) {
  const el = $('errbox');
  if (el) { el.hidden = false; el.textContent += msg + ' ｜ '; }
}
window.addEventListener('error', (e) => err('JS: ' + e.message));
window.addEventListener('unhandledrejection', (e) => err('异步: ' + (e.reason && e.reason.message || e.reason)));

/* ---------- 模块初始化 ---------- */
const scene = createScene(canvas, { lowRes: LOWRES });
const sim = createSim();
const synth = new CicadaSynth();
const bus = createInputBus();
const game = createGame();
const ui = initUI();

const controls = new OrbitControls(scene.camera, canvas);
controls.target.set(0, -0.2, 0);
controls.enableDamping = false;
controls.enablePan = false;
controls.minDistance = 1.3;
controls.maxDistance = 6.5;
controls.minPolarAngle = 0.12;
controls.maxPolarAngle = 1.52;
controls.enabled = false;      // 默认搓动模式

let viewMode = false;
function setMode(m) {
  viewMode = m;
  controls.enabled = m;
  if (!m) {
    // 把 OrbitControls 的机位同步回轻量视角控制器
    const off = scene.camera.position.clone().sub(controls.target);
    const dist = off.length();
    const pitch = Math.acos(Math.min(1, Math.max(-1, off.y / dist)));
    const yaw = Math.atan2(off.x, off.z);
    scene.setView({ yaw, pitch, dist });
  }
  ui.setMode(m);
}

/* ---------- 音频解锁（首次交互） ---------- */
let audioUnlocked = false;
async function unlockAudio() {
  if (audioUnlocked || NOAUDIO) return;
  audioUnlocked = true;
  try { await synth.init(); } catch (e) { err('音频: ' + e.message); }
}
['pointerdown', 'touchstart', 'keydown'].forEach((ev) =>
  window.addEventListener(ev, unlockAudio, { passive: true })
);
// 演示模式不自动开音频：无音频设备的环境里 AudioContext 构造可能阻塞，
// 且浏览器自动播放策略下首次交互开声更稳妥。

/* ---------- 指针输入：搓动 / 拧转 / 右键视角 ---------- */
const rubDet = createRubDetector(1700);       // px/s
const twistDet = createTwistDetector(7);       // rad/s
const pointers = new Map();                    // pointerId → {x,y}
let orbitDrag = null;
let lastTap = { t: 0, x: 0, y: 0 };

function pointerXY(e) { return { x: e.clientX, y: e.clientY }; }

canvas.addEventListener('pointerdown', (e) => {
  unlockAudio();
  if (viewMode) return;                        // OrbitControls 接管
  if (e.button === 2) { orbitDrag = pointerXY(e); return; }
  canvas.classList.add('rubbing');
  try { canvas.setPointerCapture(e.pointerId); } catch (ex) { /* 忽略 */ }
  pointers.set(e.pointerId, pointerXY(e));
});

window.addEventListener('pointermove', (e) => {
  const now = performance.now() / 1000;
  if (orbitDrag) {
    const p = pointerXY(e);
    scene.orbitDelta(p.x - orbitDrag.x, p.y - orbitDrag.y);
    orbitDrag = p;
    return;
  }
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, pointerXY(e));
  if (viewMode) return;
  if (pointers.size === 1) {
    const p = [...pointers.values()][0];
    const r = rubDet(p.x, now);
    bus.report('pointer', r.v, r.dir);
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const ang = Math.atan2(a.y - b.y, a.x - b.x);
    const r = twistDet(ang, now);
    bus.report('twist', r.v, r.dir);
  }
});

function endPointer(e) {
  if (orbitDrag && e.button === 2) { orbitDrag = null; return; }
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (pointers.size === 0) {
    canvas.classList.remove('rubbing');
    bus.report('pointer', 0, 1);
    bus.report('twist', 0, 1);
  }
  // 双击切换模式
  const p = pointerXY(e);
  const now = performance.now();
  if (now - lastTap.t < 380 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
    setMode(!viewMode);
    lastTap.t = 0;
  } else {
    lastTap = { t: now, x: p.x, y: p.y };
  }
}
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('wheel', (e) => {
  if (viewMode) return;
  e.preventDefault();
  scene.zoomFactor(1 + e.deltaY * 0.0011);
}, { passive: false });

/* ---------- 键盘 ---------- */
let keysHeld = false;
window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(e.code)) {
    keysHeld = true;
    unlockAudio();
    e.preventDefault();
  } else if (e.code === 'KeyM') {
    toggleSound();
  } else if (e.code === 'KeyH') {
    openHelp();
  } else if (e.code === 'KeyV') {
    setMode(!viewMode);
  }
});
window.addEventListener('keyup', (e) => {
  if (['Space', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(e.code)) keysHeld = false;
});

/* ---------- 摇一摇 ---------- */
const shakeDet = createShakeDetector();
let shakeOn = false;
function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a) return;
  const r = shakeDet(a.x || 0, a.y || 0, a.z || 0, performance.now() / 1000);
  bus.report('shake', r.v, r.dir);
}
ui.el.btnShake.addEventListener('click', async () => {
  if (shakeOn) {
    shakeOn = false;
    window.removeEventListener('devicemotion', onMotion);
    ui.setShakeActive(false);
    return;
  }
  const DME = window.DeviceMotionEvent;
  if (!DME) { ui.showToast('此设备不支持摇一摇'); return; }
  const enable = () => {
    shakeOn = true;
    window.addEventListener('devicemotion', onMotion);
    ui.setShakeActive(true);
    ui.showToast('📳 摇一摇已开启，摇动手机试试');
  };
  if (typeof DME.requestPermission === 'function') {
    try {
      const r = await DME.requestPermission();
      if (r === 'granted') enable();
      else ui.showToast('未授权运动传感器');
    } catch (e) { ui.showToast('摇一摇不可用'); }
  } else {
    enable();
  }
});

/* ---------- 摄像头手势（MediaPipe Hands） ---------- */
let handCtrl = null;
ui.el.btnCam.addEventListener('click', async () => {
  if (handCtrl) {
    handCtrl.stop(); handCtrl = null;
    ui.setCamActive(false); ui.setHandVisible(false);
    bus.report('hand', 0, 1);
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    ui.showToast('此环境不支持摄像头');
    return;
  }
  ui.setCamActive(true);
  ui.setHandVisible(true);
  ui.setHandStatus('load');
  handCtrl = await startHandCamera({
    video: $('handVideo'),
    canvas: $('handCv'),
    onResult: (r) => bus.report('hand', r.v > 0.02 ? r.v : 0, r.dir),
    onStatus: (cls, msg) => {
      ui.setHandStatus(cls, msg);
      if (cls === 'err') {
        ui.showToast('摄像头不可用：' + msg);
        ui.setCamActive(false);
        handCtrl = null;
      }
    },
  });
});

/* ---------- 声音 / 帮助 ---------- */
function toggleSound() {
  synth.setMuted(!synth.muted);
  ui.setSoundOn(!synth.muted);
}
ui.el.btnSound.addEventListener('click', toggleSound);

function openHelp() { ui.el.helpModal.classList.remove('hidden'); }
function closeHelp() { ui.el.helpModal.classList.add('hidden'); }
ui.el.btnHelp.addEventListener('click', openHelp);
$('btnCloseHelp').addEventListener('click', closeHelp);
$('btnGotIt').addEventListener('click', closeHelp);
ui.el.helpModal.addEventListener('click', (e) => { if (e.target === ui.el.helpModal) closeHelp(); });

ui.el.modeChip.addEventListener('click', () => setMode(!viewMode));

/* ---------- 开场镜头 ---------- */
const intro = { t0: -1, dur: 2.6 };
function introStep(t) {
  if (intro.t0 < 0) { intro.t0 = t; scene.setView({ ...scene.introView }); }
  const k = Math.min(1, (t - intro.t0) / intro.dur);
  const e = 1 - Math.pow(1 - k, 3);
  const a = scene.introView, b = scene.defaultView;
  scene.setView({
    yaw: a.yaw + (b.yaw - a.yaw) * e,
    pitch: a.pitch + (b.pitch - a.pitch) * e,
    dist: a.dist + (b.dist - a.dist) * e,
  });
}

/* ---------- 演示模式（?demo=1 自动搓动，用于截图/展示） ---------- */
function demoInput() {
  const cyc = sim.t % 11;
  if (cyc > 5.2) return { v: 0, dir: 1 };
  const dir = Math.sin(sim.t * Math.PI * 2 * 2.2) >= 0 ? 1 : -1;
  return { v: 0.9, dir };
}

/* ---------- 主循环 ---------- */
let last = performance.now();
let lastPersist = 0;

function frame(now) {
  if (!TIMERTICK) requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const t = now / 1000;

  if (keysHeld) {
    const k = keyboardRub(sim.t, true);
    bus.report('keys', k.v, k.dir);
  } else {
    bus.report('keys', 0, 1);
  }

  let input = bus.read();
  if (DEMO) input = demoInput();

  stepSim(sim, input, dt);
  synth.setSpin(Math.abs(sim.omega));
  const gameSt = game.update(sim, dt);
  scene.setState(sim, synth.cur, t, input.v);

  if (gameSt.events.length) ui.onEvents(gameSt.events);
  ui.update(sim, gameSt, synth, input);

  if (!NORENDER) scene.render();
  if (viewMode) controls.update();
  if (intro.t0 < 0 && sim.t > 0.25) introStep(t);
  else if (intro.t0 >= 0 && t - intro.t0 < intro.dur + 0.05) introStep(t);

  if (t - lastPersist > 5) { game.persist(); lastPersist = t; }
}

/* ---------- 尺寸与生命周期 ---------- */
window.addEventListener('resize', () => {
  scene.resize(window.innerWidth, window.innerHeight);
});
window.addEventListener('pagehide', () => { game.persist(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { bus.reset(); game.persist(); }
});

// 调试钩子（自动测试使用）
window.__SIM = sim;
window.__SYNTH = synth;

// 自动交互测试（?itest=1）
if (qs.has('itest')) {
  import('../test/itest.js').then((m) => m.run(sim, canvas, ui)).catch((e) => err('itest: ' + e.message));
}

// 主循环启动：默认 rAF 自续；无头虚拟时间测试用定时器（?timertick=1）
if (TIMERTICK) {
  setInterval(() => frame(performance.now()), 16);
} else {
  requestAnimationFrame(frame);
}
