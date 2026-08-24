// ===== MediaPipe Hands 摄像头手势控制 =====
// 使用 @mediapipe/tasks-vision 的 HandLandmarker（MediaPipe Hands 官方方案）。
// 手势语义（对应真实玩法“搓竹柄”）：
//   - 单手掌心快速左右摆动  → 搓动
//   - 双手做“搓手”动作（掌心距离快速往复）→ 搓动
// 输出统一为 { v, dir } 喂给输入总线。
// 检测算法（createHandAnalyzer）为纯函数，可用合成数据自动测试。

import { createRubDetector } from './input.js';

/* ---------- 修复：MediaPipe 脚本加载器与无 CORS 静态托管 ----------
 * MediaPipe 内部用 document.createElement('script') + crossOrigin='anonymous'
 * 加载 wasm 脚本（见 vision_bundle.js 的 Wo 函数）。同源加载若服务器未返回
 * Access-Control-Allow-Origin 头，浏览器会以 CORS 失败拒绝该脚本，
 * 且错误对象是无 message 的 ErrorEvent（表现为 "object event"）。
 * 本修复屏蔽动态 script 元素上的 crossOrigin 赋值——同源脚本无需 CORS。 */
let scriptPatchDone = false;
function patchScriptCrossOrigin() {
  if (scriptPatchDone || typeof document === 'undefined') return;
  scriptPatchDone = true;
  const origCreate = document.createElement.bind(document);
  document.createElement = function (tagName, options) {
    const el = origCreate(tagName, options);
    if (String(tagName).toLowerCase() === 'script') {
      try {
        Object.defineProperty(el, 'crossOrigin', {
          configurable: true,
          get() { return null; },
          set() { /* 屏蔽：同源脚本加载不需要 CORS 模式 */ },
        });
      } catch (e) { /* 忽略 */ }
    }
    return el;
  };
}

/** 详尽描述错误对象（普通 Error / ErrorEvent / 裸对象都能看清） */
function describeError(e) {
  if (!e) return '未知错误';
  const parts = [];
  if (e.name) parts.push('name=' + e.name);
  if (e.message) parts.push('message=' + e.message);
  if (e.constructor && e.constructor.name) parts.push('type=' + e.constructor.name);
  if (e.type) parts.push('event=' + e.type);
  if (e.target && e.target.src) parts.push('src=' + e.target.src);
  if (typeof e.filename === 'string' && e.filename) parts.push('file=' + e.filename + ':' + (e.lineno || ''));
  return parts.length ? parts.join(' ') : String(e);
}

export const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],
];

/** 多手搓动分析器：输入手掌中心（已镜像为屏幕坐标），输出搓动信号 */
export function createHandAnalyzer() {
  const perHand = new Map();
  const palmDist = createRubDetector(2.2);   // 双掌距离振荡
  return function feed(hands, t) {
    let best = { v: 0, dir: 1, mode: 'none' };
    for (let i = 0; i < hands.length; i++) {
      const key = hands[i].label || i;
      let det = perHand.get(key);
      if (!det) { det = createRubDetector(2.3); perHand.set(key, det); }
      const r = det(hands[i].px, t);
      if (r.v > best.v) best = { v: r.v, dir: r.dir, mode: 'hand' };
    }
    if (hands.length >= 2) {
      const h0 = hands[0], h1 = hands[1];
      const d = Math.hypot(h0.px - h1.px, h0.py - h1.py);
      const r = palmDist(d, t);
      if (r.v > best.v) best = { v: r.v, dir: r.dir, mode: 'palms' };
    }
    return best;
  };
}

/* ---------- MediaPipe 加载与相机循环 ---------- */

// 资源位置：本地内置优先（大陆微信环境可离线工作），CDN 兜底
// 注意1：MediaPipe 包用 .js 后缀（部分静态托管对 .mjs 返回错误的 MIME，浏览器会拒载）
// 注意2：URL 相对路径基于 import.meta.url（/js/gesture.js），vendor 在 ./vendor/mediapipe/
const LOCAL_MP = new URL('./vendor/mediapipe/', import.meta.url).href;
const LOCAL_ESM = LOCAL_MP + 'vision_bundle.js';
const LOCAL_WASM = LOCAL_MP + 'wasm';
const LOCAL_MODEL = LOCAL_MP + 'hand_landmarker.task';

async function loadTasksVision() {
  const urls = [
    LOCAL_ESM,
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs',
    'https://unpkg.com/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs',
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm',
  ];
  let lastErr = null;
  for (const u of urls) {
    try { return await import(/* @vite-ignore */ u); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('MediaPipe 加载失败');
}

async function loadFileset(vision) {
  const bases = [
    LOCAL_WASM,
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  ];
  let lastErr = null;
  for (const b of bases) {
    try { return await vision.FilesetResolver.forVisionTasks(b); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('MediaPipe WASM 加载失败');
}

const MODEL_URLS = [
  LOCAL_MODEL,
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
];

/**
 * 启动摄像头 + MediaPipe Hands。
 * @param {{video, canvas, onResult, onStatus}} opts
 * @returns 控制句柄 {stop}
 */
export async function startHandCamera({ video, canvas, onResult, onStatus }) {
  const g2d = canvas.getContext('2d');
  const analyzer = createHandAnalyzer();
  let landmarker = null;
  let stream = null;
  let raf = 0;
  let lastVideoTime = -1;
  let lastDetect = 0;
  let stopped = false;

  const setStatus = (cls, msg) => onStatus && onStatus(cls, msg);

  patchScriptCrossOrigin();
  let stage = '启动';
  let detectErrs = 0;
  try {
    stage = '加载模型包';
    setStatus('load', '加载模型包…');
    const vision = await loadTasksVision();
    stage = '加载 WASM';
    setStatus('load', '加载 WASM…');
    const fileset = await loadFileset(vision);
    stage = '请求摄像头';
    setStatus('load', '请求摄像头…');
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    stage = '创建识别器';
    setStatus('load', '创建识别器…');

    const createOpts = (delegate, modelUrl) => vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelUrl, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
    });
    try {
      try {
        landmarker = await createOpts('GPU', MODEL_URLS[0]);
      } catch (e) {
        landmarker = await createOpts('CPU', MODEL_URLS[0]);
      }
    } catch (e) {
      // 本地模型失败 → 退回 CDN 模型
      try {
        landmarker = await createOpts('GPU', MODEL_URLS[1]);
      } catch (e2) {
        landmarker = await createOpts('CPU', MODEL_URLS[1]);
      }
    }
    setStatus('live', '手势识别中');
  } catch (e) {
    setStatus('err', `[${stage}] ${describeError(e)}`);
    return { stop: () => {} };
  }

  function loop(now) {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    if (!landmarker || video.readyState < 2) return;
    if (video.currentTime === lastVideoTime) return;   // 无新帧
    lastVideoTime = video.currentTime;
    if (now - lastDetect < 33) return;                 // ~30fps 检测
    lastDetect = now;

    let res = null;
    try { res = landmarker.detectForVideo(video, now); } catch (e) {
      detectErrs++;
      if (detectErrs === 1) setStatus('err', `[识别循环] ${describeError(e)}`);
      return;
    }

    const W = canvas.width, H = canvas.height;
    g2d.clearRect(0, 0, W, H);
    // 视频画面（镜像）
    g2d.save();
    g2d.translate(W, 0);
    g2d.scale(-1, 1);
    g2d.drawImage(video, 0, 0, W, H);
    g2d.restore();

    // 骨架 + 手掌中心
    const hands = [];
    if (res && res.landmarks) {
      res.landmarks.forEach((lm, hi) => {
        let px = 0, py = 0;
        for (const i of [0, 9]) { px += lm[i].x; py += lm[i].y; }
        px /= 2; py /= 2;
        const handed = res.handednesses && res.handednesses[hi] && res.handednesses[hi][0];
        hands.push({ px: 1 - px, py, label: handed ? handed.categoryName : null });
        g2d.strokeStyle = 'rgba(120,255,140,0.9)';
        g2d.lineWidth = 2;
        g2d.beginPath();
        for (const [a, b] of HAND_CONNECTIONS) {
          g2d.moveTo((1 - lm[a].x) * W, lm[a].y * H);
          g2d.lineTo((1 - lm[b].x) * W, lm[b].y * H);
        }
        g2d.stroke();
        g2d.fillStyle = '#7cff8c';
        for (const pt of lm) {
          g2d.beginPath();
          g2d.arc((1 - pt.x) * W, pt.y * H, 2.2, 0, Math.PI * 2);
          g2d.fill();
        }
      });
    }
    const r = analyzer(hands, now / 1000);
    onResult && onResult(r);
  }
  raf = requestAnimationFrame(loop);

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((tr) => tr.stop());
      video.srcObject = null;
      if (landmarker) { try { landmarker.close(); } catch (e) { /* 忽略 */ } }
    },
  };
}
