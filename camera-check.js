// 摄像头手势独立自检：复用游戏同一个加载链路，逐步展示成败
import { startHandCamera } from './js/gesture.js';

const logEl = document.getElementById('log');
const box = document.getElementById('videoBox');
const lines = [];
function log(text, cls) {
  lines.push(text);
  logEl.innerHTML = lines.map((l) => `<div class="${l.cls}">${l.text}</div>`).join('');
}
function step(name, ok, msg) {
  log({ text: `${ok ? '✅' : '❌'} ${name}${msg ? '：' + msg : ''}`, cls: ok ? 'ok' : 'fail' });
}
log({ text: '环境: ' + navigator.userAgent, cls: 'info' });
log({ text: '页面协议: ' + location.protocol + ' (摄像头需要 https)', cls: 'info' });
log({ text: 'navigator.mediaDevices: ' + (navigator.mediaDevices ? '存在' : '不存在'), cls: 'info' });

document.getElementById('go').addEventListener('click', async () => {
  lines.length = 0;
  box.style.display = 'block';
  let lastStage = '就绪';
  const ctrl = await startHandCamera({
    video: document.getElementById('v'),
    canvas: document.getElementById('c'),
    onResult: (r) => { /* 手势数据 */ },
    onStatus: (cls, msg) => {
      if (cls === 'live') { lastStage = 'live'; log({ text: `✅ 手势识别运行中（请把手伸到镜头前，应看到绿色骨架）`, cls: 'ok' }); }
      else if (cls === 'err') log({ text: `❌ 失败于「${lastStage}」阶段：${msg}`, cls: 'fail' });
      else { lastStage = msg || lastStage; log({ text: `⏳ ${msg}`, cls: 'info' }); }
    },
  });
  // 5 秒后仍在运行 → 成功；期间若无 err 也标记完成
  setTimeout(() => {
    if (lastStage === 'live') log({ text: '✅ 自检通过：模型、WASM、摄像头、识别全部正常。', cls: 'ok' });
    else log({ text: '⚠️ 5 秒内未进入识别状态，请把上面的错误信息截图发给开发者。', cls: 'fail' });
  }, 5000);
  window.__ctrl = ctrl;
});
