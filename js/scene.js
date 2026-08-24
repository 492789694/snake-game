// ===== 竹知了 · Three.js 3D 场景 =====
// 竹筒（程序化竹纹 + 竹节）、牛皮纸膜（中央小孔 + 红色标记点）、
// 棉线（带垂坠的曲线）、竹柄。旋转可视化：
//   - 6 层残影（ghost）拖尾：转速越快拖尾越长、越明显
//   - 膜面“角向运动模糊”贴图：转速越高膜纹越糊成圈
//   - 高频振动：膜片与整筒随音频 f0 抖动

import * as THREE from 'three';
import { P } from './physics.js';

const N_GHOST = 6;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ss = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/* ---------- 程序化贴图 ---------- */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

let bambooCache = null;
function bambooMaps() {
  if (bambooCache) return bambooCache;
  const [cv, g] = makeCanvas(512, 256);
  const [bumpCv, bg] = makeCanvas(512, 256);
  g.fillStyle = '#d9b45f'; g.fillRect(0, 0, 512, 256);
  bg.fillStyle = '#808080'; bg.fillRect(0, 0, 512, 256);

  // 纵向竹丝纹理（沿竹筒长度方向）
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * 512;
    const w = 1 + Math.random() * 3.2;
    const dark = Math.random() < 0.55;
    const alpha = 0.04 + Math.random() * 0.13;
    g.strokeStyle = dark ? `rgba(122,92,45,${alpha})` : `rgba(255,240,190,${alpha})`;
    g.lineWidth = w;
    g.beginPath();
    let y = 0, px = x;
    g.moveTo(px, y);
    for (let yy = 0; yy <= 256; yy += 16) {
      px = x + Math.sin(yy * 0.045 + i) * 2.2;   // 轻微波浪，竹纤维质感
      g.lineTo(px, yy);
    }
    g.stroke();
    // 凹凸图：深纹亮、浅纹暗
    bg.strokeStyle = dark ? 'rgba(60,60,60,0.5)' : 'rgba(255,255,255,0.5)';
    bg.lineWidth = w + 0.6;
    bg.beginPath();
    let bx = x;
    bg.moveTo(bx, 0);
    for (let yy = 0; yy <= 256; yy += 16) { bx = x + Math.sin(yy * 0.045 + i) * 2.2; bg.lineTo(bx, yy); }
    bg.stroke();
  }

  // 竹节（两圈）
  const node = (y) => {
    g.fillStyle = 'rgba(122,84,38,0.85)'; g.fillRect(0, y, 512, 9);
    g.fillStyle = 'rgba(255,235,170,0.8)'; g.fillRect(0, y - 4, 512, 3.5);
    g.fillStyle = 'rgba(90,60,25,0.5)'; g.fillRect(0, y + 9, 512, 2.5);
    bg.fillStyle = 'rgba(30,30,30,0.85)'; bg.fillRect(0, y, 512, 9);
    bg.fillStyle = 'rgba(240,240,240,0.8)'; bg.fillRect(0, y - 4, 512, 3.5);
  };
  node(64); node(192);

  // 细杂点
  for (let i = 0; i < 2400; i++) {
    const x = Math.random() * 512, y = Math.random() * 256;
    const a = 0.02 + Math.random() * 0.05;
    g.fillStyle = Math.random() < 0.5 ? `rgba(105,78,38,${a})` : `rgba(255,246,205,${a})`;
    g.fillRect(x, y, 1.4, 1.4);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(bumpCv);
  bambooCache = { map: tex, bumpMap: bump };
  return bambooCache;
}

let membraneBase = null;
function membraneBaseTexture() {
  if (membraneBase) return membraneBase;
  const [cv, g] = makeCanvas(256, 256);
  g.clearRect(0, 0, 256, 256);
  // 牛皮纸圆面
  g.save();
  g.beginPath(); g.arc(128, 128, 122, 0, Math.PI * 2);
  g.fillStyle = '#d9c08e'; g.fill();
  g.clip();
  // 径向纸纤维
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    const r0 = 14 + Math.random() * 20;
    const r1 = 90 + Math.random() * 60;
    g.strokeStyle = `rgba(150,120,70,${0.05 + Math.random() * 0.1})`;
    g.lineWidth = 0.8 + Math.random() * 1.6;
    g.beginPath();
    g.moveTo(128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0);
    g.lineTo(128 + Math.cos(a) * r1, 128 + Math.sin(a) * r1);
    g.stroke();
  }
  // 同心细纹
  for (let r = 40; r <= 116; r += 15) {
    g.strokeStyle = 'rgba(140,110,60,0.16)';
    g.beginPath(); g.arc(128, 128, r, 0, Math.PI * 2); g.stroke();
  }
  // 中央小孔（透明）
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.arc(128, 128, 8, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'source-over';
  g.restore();
  // 边缘压线
  g.strokeStyle = 'rgba(120,92,45,0.85)';
  g.lineWidth = 3;
  g.beginPath(); g.arc(128, 128, 120, 0, Math.PI * 2); g.stroke();
  // 旋转可见性标记：红点 + 细线
  g.fillStyle = '#b23a2a';
  g.beginPath(); g.arc(128 + 84, 128, 7, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(178,58,42,0.75)';
  g.lineWidth = 2.4;
  g.beginPath(); g.moveTo(136, 128); g.lineTo(214, 128); g.stroke();

  membraneBase = new THREE.CanvasTexture(cv);
  membraneBase.colorSpace = THREE.SRGBColorSpace;
  return membraneBase;
}

// 角向运动模糊：把膜面绕中心旋转多次叠加 → 转速越高越“糊成圈”
const smearCache = new Map();
function membraneSmear(level) {
  if (level <= 0) return membraneBaseTexture();
  if (smearCache.has(level)) return smearCache.get(level);
  const [cv, g] = makeCanvas(256, 256);
  const base = membraneBaseTexture();
  const passes = level * 6;
  for (let i = 0; i < passes; i++) {
    const a = (i / passes) * Math.PI * 2;
    g.save();
    g.translate(128, 128);
    g.rotate(a);
    g.globalAlpha = 0.55 / passes;
    g.drawImage(base.image, -128, -128);
    g.restore();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  smearCache.set(level, tex);
  return tex;
}

/* ---------- 场景构建 ---------- */

export function createScene(canvas, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !opts.lowRes, alpha: true });
  renderer.setPixelRatio(opts.lowRes ? 0.5 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = !opts.lowRes;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40);

  // 灯光
  const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x8a7a52, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d8, 2.4);
  sun.position.set(3.2, 5.5, 2.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -2.8;
  sun.shadow.camera.right = 2.8;
  sun.shadow.camera.top = 2.8;
  sun.shadow.camera.bottom = -2.8;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 14;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  const fill = new THREE.PointLight(0xffd9a0, 0.5, 9);
  fill.position.set(-1.8, 0.4, 1.6);
  scene.add(fill);

  // 地面投影接收
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.ShadowMaterial({ opacity: 0.22, transparent: true })
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = -1.62;
  shadowPlane.receiveShadow = true;
  scene.add(shadowPlane);

  // —— 材质 ——
  const bm = bambooMaps();
  const matBamboo = new THREE.MeshStandardMaterial({
    map: bm.map, bumpMap: bm.bumpMap, bumpScale: 0.006,
    roughness: 0.6, metalness: 0.03,
  });
  const matRing = new THREE.MeshStandardMaterial({ color: 0x7d5a28, roughness: 0.65 });
  const matMembrane = new THREE.MeshStandardMaterial({
    map: membraneBaseTexture(), transparent: true, roughness: 0.9, side: THREE.DoubleSide,
  });
  const matKnot = new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.8 });
  const matInner = new THREE.MeshBasicMaterial({ color: 0x1c1208 });
  const matString = new THREE.LineBasicMaterial({ color: 0xefe6cf, transparent: true, opacity: 0.9 });

  // —— 几何体 ——
  const geoTube = new THREE.CylinderGeometry(0.055, 0.055, 0.17, 40);
  const geoRing = new THREE.CylinderGeometry(0.0635, 0.0635, 0.016, 40);
  const geoMembrane = new THREE.CircleGeometry(0.059, 48);
  const geoKnot = new THREE.SphereGeometry(0.014, 12, 10);
  const geoInner = new THREE.CircleGeometry(0.046, 40);
  const geoHandle = new THREE.CylinderGeometry(0.02, 0.024, 0.44, 24);
  const geoCap = new THREE.SphereGeometry(0.026, 16, 12);
  const geoGrip = new THREE.CylinderGeometry(0.027, 0.027, 0.08, 20);

  const TUBE_L = 0.17;
  const MEMB_Z = -TUBE_L / 2 - 0.0015;   // 膜在朝向竹柄的一端
  const KNOT_Z = MEMB_Z - 0.007;

  // 竹筒组件（绕 Z 轴自转）
  function buildSpinParts(mats) {
    const g = new THREE.Group();
    const tube = new THREE.Mesh(geoTube, mats.bamboo);
    tube.rotation.x = Math.PI / 2;
    g.add(tube);
    const ringA = new THREE.Mesh(geoRing, mats.ring);
    ringA.rotation.x = Math.PI / 2;
    ringA.position.z = TUBE_L / 2;
    g.add(ringA);
    const ringB = new THREE.Mesh(geoRing, mats.ring);
    ringB.rotation.x = Math.PI / 2;
    ringB.position.z = -TUBE_L / 2 - 0.002;
    g.add(ringB);
    const membrane = new THREE.Mesh(geoMembrane, mats.membrane);
    membrane.rotation.y = Math.PI;          // 法线朝 −Z（朝向竹柄）
    membrane.position.z = MEMB_Z;
    g.add(membrane);
    const knot = new THREE.Mesh(geoKnot, mats.knot);
    knot.position.z = KNOT_Z;
    g.add(knot);
    const inner = new THREE.Mesh(geoInner, mats.inner);
    inner.position.z = TUBE_L / 2 + 0.0015; // 开口端可见的空腔
    g.add(inner);
    return { group: g, membrane, knot, tube };
  }

  // —— 手柄 ——
  const handle = new THREE.Group();
  const handleMesh = new THREE.Mesh(geoHandle, matBamboo);
  handleMesh.position.y = 0.02;
  handleMesh.castShadow = true;
  handle.add(handleMesh);
  const cap = new THREE.Mesh(geoCap, matBamboo);
  cap.position.y = 0.248;
  cap.castShadow = true;
  handle.add(cap);
  const grip = new THREE.Mesh(geoGrip, matRing);
  grip.position.y = -0.13;
  grip.castShadow = true;
  handle.add(grip);
  scene.add(handle);

  const PIVOT = new THREE.Vector3(0, 0.252, 0);

  // —— 自转主体 ——
  const spinRoot = new THREE.Group();
  const mats = {
    bamboo: matBamboo, ring: matRing, membrane: matMembrane,
    knot: matKnot, inner: matInner,
  };
  const main = buildSpinParts(mats);
  const spinInner = new THREE.Group();
  spinInner.add(main.group);
  spinRoot.add(spinInner);
  spinRoot.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  scene.add(spinRoot);

  // —— 残影 ghost（透明拖尾，展示转速） ——
  const ghostRoot = new THREE.Group();
  const ghosts = [];
  for (let i = 0; i < N_GHOST; i++) {
    const gm = {
      bamboo: matBamboo.clone(), ring: matRing.clone(), membrane: matMembrane.clone(),
      knot: matKnot.clone(), inner: matInner.clone(),
    };
    for (const k in gm) {
      gm[k].transparent = true;
      gm[k].depthWrite = false;
      gm[k].opacity = 0;
    }
    const parts = buildSpinParts(gm);
    parts.group.traverse((o) => { if (o.isMesh) o.renderOrder = 10; });
    ghosts.push({ group: parts.group, mats: gm, membrane: parts.membrane });
    ghostRoot.add(parts.group);
  }
  scene.add(ghostRoot);

  // —— 棉线（带垂坠的曲线） ——
  const STRING_PTS = 7;
  const stringGeo = new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: STRING_PTS }, () => new THREE.Vector3())
  );
  const stringLine = new THREE.Line(stringGeo, matString);
  scene.add(stringLine);

  // —— 竹叶粒子（氛围） ——
  const leaves = [];
  {
    const leafGeo = new THREE.PlaneGeometry(0.055, 0.15);
    for (let i = 0; i < 14; i++) {
      const m = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.24 + Math.random() * 0.06, 0.32 + Math.random() * 0.2, 0.45 + Math.random() * 0.2),
        transparent: true, opacity: 0.4 + Math.random() * 0.3, side: THREE.DoubleSide, depthWrite: false,
      });
      const leaf = new THREE.Mesh(leafGeo, m);
      leaf.position.set((Math.random() - 0.5) * 4.6, (Math.random() - 0.5) * 3.6, (Math.random() - 0.5) * 3.6);
      leaf.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      scene.add(leaf);
      leaves.push({
        mesh: leaf,
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.12, -0.03 - Math.random() * 0.05, (Math.random() - 0.5) * 0.12),
        spinV: (Math.random() - 0.5) * 0.9,
      });
    }
  }

  // —— 视角控制（非 OrbitControls 的轻量实现，供“搓动模式”下右键/滚轮使用） ——
  const view = { yaw: 0.55, pitch: 0.95, dist: 3.4 };
  const TARGET = new THREE.Vector3(0, -0.2, 0);
  function applyView() {
    const sp = Math.sin(view.pitch);
    camera.position.set(
      TARGET.x + view.dist * sp * Math.sin(view.yaw),
      TARGET.y + view.dist * Math.cos(view.pitch),
      TARGET.z + view.dist * sp * Math.cos(view.yaw)
    );
    camera.lookAt(TARGET);
  }
  function orbitDelta(dx, dy) {
    view.yaw -= dx * 0.0055;
    view.pitch = clamp01((view.pitch - dy * 0.0045 - 0.12) / 1.4) * 1.4 + 0.12;
    applyView();
  }
  function zoomFactor(f) {
    view.dist = clamp01((view.dist * f - 1.3) / 5.2) * 5.2 + 1.3;
    applyView();
  }
  function setView(v) {
    view.yaw = v.yaw; view.pitch = v.pitch; view.dist = v.dist;
    applyView();
  }

  // —— 每帧状态同步 ——
  const Z = new THREE.Vector3(0, 0, 1);
  const UP = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const sagDir = new THREE.Vector3();
  let curBand = -1;

  function setState(sim, p, t, inputV) {
    const theta = sim.theta, phi = sim.phi;
    const s = Math.sin(theta);
    dir.set(s * Math.cos(phi), -Math.cos(theta), s * Math.sin(phi));

    spinRoot.position.copy(PIVOT).addScaledVector(dir, P.L);
    spinRoot.quaternion.setFromUnitVectors(Z, dir);
    spinInner.rotation.z = sim.spin;

    // 残影拖尾
    const om = Math.abs(sim.omega);
    const vis = ss(6, 30, om);
    const tau = 0.042 * (0.55 + 0.45 * Math.min(1, om / 165));
    for (let i = 0; i < ghosts.length; i++) {
      const g = ghosts[i];
      g.group.rotation.z = sim.spin - om * tau * (i + 1);
      const op = 0.34 * (1 - (i + 0.5) / N_GHOST) * vis;
      g.group.visible = op > 0.012;
      for (const k in g.mats) g.mats[k].opacity = op;
    }
    ghostRoot.position.copy(spinRoot.position);
    ghostRoot.quaternion.copy(spinRoot.quaternion);

    // 高频振动（视觉上让膜片/整筒“嗡嗡”抖）
    const env = p ? p.env : 0;
    const f0 = p ? p.f0 : 0;
    const vib = Math.sin(2 * Math.PI * f0 * t);
    main.membrane.position.z = MEMB_Z + 0.006 * env * vib;
    main.knot.position.z = KNOT_Z + 0.004 * env * vib;
    spinRoot.position.addScaledVector(dir, 0.004 * env * vib);

    // 手柄随搓动摆动
    handle.rotation.z = 0.13 * inputV * Math.sin(t * 30);
    handle.rotation.x = 0.06 * inputV * Math.sin(t * 23 + 1.3);

    // 棉线曲线：高速绷直、悬挂时自然垂坠
    const p0 = PIVOT;
    const p2 = new THREE.Vector3()
      .copy(spinRoot.position)
      .addScaledVector(dir, -0.006);   // 系在膜孔绳结处
    sagDir.crossVectors(dir, UP);
    if (sagDir.lengthSq() < 1e-6) sagDir.set(Math.cos(phi), 0, Math.sin(phi));
    else sagDir.normalize();
    const sag = 0.06 * Math.cos(theta) * (1 - Math.min(1, om / 40));
    const p1 = new THREE.Vector3()
      .copy(p0).addScaledVector(dir, P.L * 0.5)
      .addScaledVector(sagDir, sag);
    const pts = stringGeo.attributes.position;
    for (let i = 0; i < STRING_PTS; i++) {
      const tt = i / (STRING_PTS - 1);
      const a = (1 - tt) * (1 - tt), b = 2 * (1 - tt) * tt, c = tt * tt;
      pts.setXYZ(i,
        a * p0.x + b * p1.x + c * p2.x,
        a * p0.y + b * p1.y + c * p2.y,
        a * p0.z + b * p1.z + c * p2.z);
    }
    pts.needsUpdate = true;

    // 膜面运动模糊档位
    const band = om < 25 ? 0 : om < 60 ? 1 : om < 100 ? 2 : 3;
    if (band !== curBand) {
      curBand = band;
      const tex = membraneSmear(band);
      matMembrane.map = tex;
      matMembrane.needsUpdate = true;
      ghosts.forEach((g, i) => {
        g.mats.membrane.map = membraneSmear(Math.max(0, band - 1));
        g.mats.membrane.needsUpdate = true;
      });
    }

    // 竹叶飘落
    for (const lf of leaves) {
      const m = lf.mesh;
      m.position.addScaledVector(lf.vel, 1 / 60);
      m.rotation.z += lf.spinV / 60;
      if (m.position.y < -2.0) m.position.y = 2.2;
      if (m.position.x > 2.8) m.position.x = -2.8;
      if (m.position.x < -2.8) m.position.x = 2.8;
    }
  }

  function resize(w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function render() { renderer.render(scene, camera); }
  function stats() {
    return {
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      textures: renderer.info.memory.textures,
    };
  }

  applyView();
  resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);

  return {
    renderer, scene, camera,
    setState, render, resize, stats,
    orbitDelta, zoomFactor, setView,
    getView: () => ({ ...view }),
    defaultView: { yaw: 0.55, pitch: 0.95, dist: 3.4 },
    introView: { yaw: 1.45, pitch: 1.18, dist: 5.6 },
    dispose() { renderer.dispose(); },
  };
}
