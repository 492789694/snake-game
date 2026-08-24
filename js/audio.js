// ===== 竹知了 · Web Audio 实时蝉鸣合成 =====
// 没有使用任何录音文件。声音由以下成分实时合成：
//   - 双锯齿波（微失谐拍频）          → “蝉鸣”的哨音主体
//   - 白噪声摩擦噪声（带通）          → 棉线与膜孔摩擦的“沙沙”底噪
//   - 竹筒共鸣滤波（固定带通 ~640Hz） → 竹筒共鸣腔的“嗡嗡”音色
//   - 跟踪带通（中心=f0）             → 让音调随转速清晰可辨
//   - 幅度调制（f=2×转速）            → 旋转摩擦的周期性脉冲感
// 音调 f0 与响度包络均由实时转速连续驱动。

export const AUD = {
  fBase: 65,       // 0 转速基准 Hz
  fPerRev: 88,     // 每转/秒增加的音高 Hz（转速越快音调越高）
  fMax: 2600,      // 音高上限 Hz
  wOn: 6,          // 起鸣转速 rad/s（≈57 RPM）
  wMid: 35,        // 响度饱和中点 rad/s（≈334 RPM）
  wRef: 165,       // 参考最大转速 rad/s
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * 由实时角速度计算合成参数（纯函数，便于测试）
 * @param {number} absOmega |ω| rad/s
 */
export function paramsOf(absOmega) {
  const revS = absOmega / (2 * Math.PI);           // 转/秒
  const rpm = revS * 60;
  const f0 = Math.min(AUD.fMax, AUD.fBase + AUD.fPerRev * revS);
  // 响度包络：越过起鸣阈值后连续增长，高速段趋于饱和
  const env = smoothstep(AUD.wOn, AUD.wMid, absOmega)
    * (0.55 + 0.45 * clamp01((absOmega - AUD.wMid) / (AUD.wRef - AUD.wMid)));
  // 摩擦噪声量：转速越高摩擦越猛
  const rasp = 0.10 + 0.55 * clamp01((absOmega - 18) / 110);
  // 旋转脉冲调制深度：中低速明显（黏滑摩擦），高速趋于连续
  const amDepth = 0.30 * (1 - clamp01((absOmega - 40) / 120));
  const fRot = revS * 2;                            // 每转摩擦脉冲 2 次
  const vibHz = 3 + absOmega * 0.12;                // 弦张力颤音
  return { rpm, revS, f0, env, rasp, amDepth, fRot, vibHz };
}

export class CicadaSynth {
  constructor(ctx) {
    this.ctx = ctx || null;   // 可注入 OfflineAudioContext（用于测试）
    this.ready = false;
    this.cur = paramsOf(0);
    this._lastEnv = 0;
    this.muted = false;
  }

  async init() {
    if (this.ready) return;
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._build();
    return this._initPromise;
  }

  async _build() {
    const offline = this.ctx && typeof this.ctx.startRendering === 'function';
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    const ctx = this.ctx;
    if (!offline && ctx.state === 'suspended') {
      try {
        // 无音频设备/无用户手势的环境里 resume 可能永远不返回，加超时保护
        await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 800))]);
      } catch (e) { /* 用户手势后可再试 */ }
    }

    // —— 输出链：master → 压缩 → 分析器 → 扬声器 ——
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -20;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 3.5;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.18;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.8;
    this.master.connect(this.comp);
    this.comp.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    // —— 哨音主体：双锯齿波 ——
    this.toneBus = ctx.createGain();
    this.toneBus.gain.value = 0.5;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc1.frequency.value = 200;
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'sawtooth';
    this.osc2.frequency.value = 200;
    this.osc2.detune.value = 7;             // 微失谐 → 蝉鸣的“嗡嗡”拍频
    this.osc1.connect(this.toneBus);
    this.osc2.connect(this.toneBus);

    // 音量包络（随转速连续变化）
    this.envTone = ctx.createGain();
    this.envTone.gain.value = 0;
    this.toneBus.connect(this.envTone);

    // 竹筒共鸣（固定带通）+ 音调跟踪带通，并联
    this.bodyFilter = ctx.createBiquadFilter();
    this.bodyFilter.type = 'bandpass';
    this.bodyFilter.frequency.value = 640;
    this.bodyFilter.Q.value = 2.4;
    this.bodyGain = ctx.createGain();
    this.bodyGain.gain.value = 0.9;
    this.edgeFilter = ctx.createBiquadFilter();
    this.edgeFilter.type = 'bandpass';
    this.edgeFilter.frequency.value = 640;
    this.edgeFilter.Q.value = 6;
    this.edgeGain = ctx.createGain();
    this.edgeGain.gain.value = 0.6;
    this.envTone.connect(this.bodyFilter);
    this.bodyFilter.connect(this.bodyGain);
    this.bodyGain.connect(this.master);
    this.envTone.connect(this.edgeFilter);
    this.edgeFilter.connect(this.edgeGain);
    this.edgeGain.connect(this.master);

    // —— 摩擦噪声（棉线刮膜孔） ——
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseSrc = ctx.createBufferSource();
    this.noiseSrc.buffer = buf;
    this.noiseSrc.loop = true;
    this.envRasp = ctx.createGain();
    this.envRasp.gain.value = 0;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.value = 800;
    this.noiseFilter.Q.value = 1.3;
    this.noiseSrc.connect(this.envRasp);
    this.envRasp.connect(this.noiseFilter);
    this.noiseFilter.connect(this.master);
    this.noiseSrc.start();

    // —— 旋转脉冲幅度调制（AM） ——
    this.amLfo = ctx.createOscillator();
    this.amLfo.type = 'sine';
    this.amLfo.frequency.value = 4;
    this.amGain = ctx.createGain();
    this.amGain.gain.value = 0;
    this.amLfo.connect(this.amGain);
    this.amGain.connect(this.toneBus.gain);
    this.amLfo.start();

    // —— 弦张力颤音 ——
    this.vibLfo = ctx.createOscillator();
    this.vibLfo.type = 'sine';
    this.vibLfo.frequency.value = 5.3;
    this.vibGain = ctx.createGain();
    this.vibGain.gain.value = 0;
    this.vibLfo.connect(this.vibGain);
    this.vibGain.connect(this.osc1.frequency);
    this.vibGain.connect(this.osc2.frequency);
    this.vibLfo.start();

    this.osc1.start();
    this.osc2.start();
    this.ready = true;
    if (this.muted) this.master.gain.value = 0;
  }

  /** 每帧调用：让声音连续跟随实时转速 */
  setSpin(absOmega) {
    if (!this.ready) return;
    const p = paramsOf(absOmega);
    this.cur = p;
    const t = this.ctx.currentTime;
    // 加速时快速跟上（起音），减速时稍慢释放（自然衰弱）
    const envTc = p.env >= this._lastEnv ? 0.035 : 0.09;
    this.envTone.gain.setTargetAtTime(p.env, t, envTc);
    this.envRasp.gain.setTargetAtTime(p.env * p.rasp * 0.55, t, envTc);
    this.osc1.frequency.setTargetAtTime(p.f0, t, 0.02);
    this.osc2.frequency.setTargetAtTime(p.f0 * 1.004, t, 0.02);
    this.edgeFilter.frequency.setTargetAtTime(Math.min(3200, Math.max(300, p.f0)), t, 0.03);
    this.noiseFilter.frequency.setTargetAtTime(Math.min(4200, Math.max(420, p.f0 * 1.7)), t, 0.04);
    this.amLfo.frequency.setTargetAtTime(p.fRot, t, 0.03);
    this.amGain.gain.setTargetAtTime(p.amDepth * p.env * 0.5, t, 0.06);
    this.vibGain.gain.setTargetAtTime(p.f0 * 0.004 * (0.5 + absOmega / 70), t, 0.06);
    this._lastEnv = p.env;
  }

  setMuted(m) {
    this.muted = m;
    if (this.ready) this.master.gain.value = m ? 0 : 0.9;
  }
}

/* ---------- 测试辅助：离线渲染（无音频设备也能端到端验证声音） ---------- */

/** 用 OfflineAudioContext 把合成器在给定转速下渲染指定秒数 */
export async function renderOfflineForTest(absOmega, seconds = 0.6, sampleRate = 44100) {
  const ctx = new OfflineAudioContext(1, Math.floor(sampleRate * seconds), sampleRate);
  const synth = new CicadaSynth(ctx);
  await synth.init();
  synth.bodyGain.gain.value = 0.05;   // 压低共鸣腔，突出音调跟踪滤波
  synth.setSpin(absOmega);
  return ctx.startRendering();
}

/** 零穿越频率估计（Hz） */
export function zeroCrossFreq(buffer) {
  const d = buffer.getChannelData(0);
  let c = 0;
  for (let i = 1; i < d.length; i++) if ((d[i - 1] >= 0) !== (d[i] >= 0)) c++;
  return (c / 2) / (d.length / buffer.sampleRate);
}

/** RMS 幅度 */
export function rmsOf(buffer) {
  const d = buffer.getChannelData(0);
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  return Math.sqrt(s / d.length);
}
