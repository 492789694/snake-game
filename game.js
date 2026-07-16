const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const scoreEl = document.querySelector('#score');
const highScoreEl = document.querySelector('#highScore');
const speedEl = document.querySelector('#speed');
const overlay = document.querySelector('#overlay');
const overlayTag = document.querySelector('#overlayTag');
const overlayTitle = document.querySelector('#overlayTitle');
const overlayText = document.querySelector('#overlayText');
const startButton = document.querySelector('#startButton');
const pauseButton = document.querySelector('#pauseButton');
const restartButton = document.querySelector('#restartButton');
const soundButton = document.querySelector('#soundButton');

const GRID = 20;
const CELL = canvas.width / GRID;
const START_DELAY = 145;
let snake, food, direction, queuedDirection, score, timer, state;
let highScore = Number(localStorage.getItem('neon-snake-high-score') || 0);
let soundOn = localStorage.getItem('neon-snake-sound') !== 'off';

function reset() {
  clearTimeout(timer);
  snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
  direction = { x: 1, y: 0 };
  queuedDirection = direction;
  score = 0;
  state = 'ready';
  placeFood();
  updateHud();
  draw();
  showOverlay('准备好了吗？', '按方向键开始', '吃掉能量果实，别撞到墙壁和自己。', '开始游戏');
  pauseButton.textContent = '暂停';
}

function start() {
  if (state === 'playing') return;
  if (state === 'gameover') reset();
  state = 'playing';
  overlay.classList.add('hidden');
  scheduleTick();
}

function scheduleTick() {
  clearTimeout(timer);
  timer = setTimeout(tick, Math.max(58, START_DELAY - score * 2.5));
}

function tick() {
  if (state !== 'playing') return;
  direction = queuedDirection;
  const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };
  const hitWall = head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID;
  const hitSelf = snake.some(part => part.x === head.x && part.y === head.y);
  if (hitWall || hitSelf) return endGame();

  snake.unshift(head);
  if (head.x === food.x && head.y === food.y) {
    score += 10;
    highScore = Math.max(highScore, score);
    localStorage.setItem('neon-snake-high-score', highScore);
    beep(680, 0.06);
    placeFood();
    updateHud();
  } else {
    snake.pop();
  }
  draw();
  scheduleTick();
}

function placeFood() {
  do {
    food = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
  } while (snake && snake.some(part => part.x === food.x && part.y === food.y));
}

function setDirection(next) {
  if (next.x + direction.x === 0 && next.y + direction.y === 0) return;
  queuedDirection = next;
  if (state === 'ready') start();
}

function togglePause() {
  if (state === 'ready') return start();
  if (state === 'gameover') return;
  if (state === 'playing') {
    state = 'paused';
    clearTimeout(timer);
    pauseButton.textContent = '继续';
    showOverlay('游戏暂停', '喘口气', '准备好后继续冲击最高纪录。', '继续游戏');
  } else {
    state = 'playing';
    pauseButton.textContent = '暂停';
    overlay.classList.add('hidden');
    scheduleTick();
  }
}

function endGame() {
  state = 'gameover';
  beep(150, 0.16);
  draw(true);
  showOverlay('本局结束', `得分 ${score}`, score === highScore && score > 0 ? '新纪录！这一局相当漂亮。' : '调整路线，再来一局。', '再玩一次');
}

function showOverlay(tag, title, text, button) {
  overlayTag.textContent = tag;
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  startButton.textContent = button;
  overlay.classList.remove('hidden');
}

function updateHud() {
  scoreEl.textContent = String(score).padStart(3, '0');
  highScoreEl.textContent = String(highScore).padStart(3, '0');
  speedEl.textContent = `${(START_DELAY / Math.max(58, START_DELAY - score * 2.5)).toFixed(1)}x`;
  soundButton.textContent = `音效 ${soundOn ? '开' : '关'}`;
}

function roundedRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function draw(crashed = false) {
  ctx.fillStyle = '#09140f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(182, 255, 59, 0.055)';
  ctx.lineWidth = 1;
  for (let i = 1; i < GRID; i++) {
    ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, canvas.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(canvas.width, i * CELL); ctx.stroke();
  }

  const pulse = 0.72 + Math.sin(Date.now() / 170) * 0.16;
  ctx.save();
  ctx.shadowColor = '#ff5b78';
  ctx.shadowBlur = 22;
  ctx.fillStyle = `rgba(255, 91, 120, ${pulse})`;
  roundedRect(food.x * CELL + 7, food.y * CELL + 7, CELL - 14, CELL - 14, 9);
  ctx.fill();
  ctx.restore();

  snake.forEach((part, index) => {
    const gap = index === 0 ? 3 : 5;
    ctx.save();
    ctx.shadowColor = index === 0 ? '#b6ff3b' : '#54f9b0';
    ctx.shadowBlur = index === 0 ? 18 : 8;
    ctx.fillStyle = crashed && index === 0 ? '#ff5b78' : index === 0 ? '#b6ff3b' : `hsl(${151 - Math.min(index, 30)}, 88%, ${61 - Math.min(index, 22) * .8}%)`;
    roundedRect(part.x * CELL + gap, part.y * CELL + gap, CELL - gap * 2, CELL - gap * 2, index === 0 ? 9 : 7);
    ctx.fill();
    ctx.restore();
  });
}

function beep(frequency, duration) {
  if (!soundOn) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const audio = new AudioContext();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = frequency;
  oscillator.type = 'sine';
  gain.gain.setValueAtTime(.05, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + duration);
}

const directions = {
  ArrowUp: { x: 0, y: -1 }, w: { x: 0, y: -1 }, W: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 }, s: { x: 0, y: 1 }, S: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 }, a: { x: -1, y: 0 }, A: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 }, d: { x: 1, y: 0 }, D: { x: 1, y: 0 }
};

document.addEventListener('keydown', event => {
  if (directions[event.key]) {
    event.preventDefault();
    setDirection(directions[event.key]);
  } else if (event.code === 'Space') {
    event.preventDefault();
    togglePause();
  }
});

document.querySelectorAll('[data-direction]').forEach(button => {
  button.addEventListener('pointerdown', () => {
    const map = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
    setDirection(map[button.dataset.direction]);
  });
});

let touchStart = null;

canvas.addEventListener('pointerdown', event => {
  if (event.pointerType === 'mouse') return;
  touchStart = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture?.(event.pointerId);
});

canvas.addEventListener('pointermove', event => {
  if (!touchStart || event.pointerType === 'mouse') return;
  event.preventDefault();
});

canvas.addEventListener('pointerup', event => {
  if (!touchStart || event.pointerType === 'mouse') return;
  const dx = event.clientX - touchStart.x;
  const dy = event.clientY - touchStart.y;
  touchStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
  if (Math.abs(dx) > Math.abs(dy)) {
    setDirection({ x: dx > 0 ? 1 : -1, y: 0 });
  } else {
    setDirection({ x: 0, y: dy > 0 ? 1 : -1 });
  }
});

canvas.addEventListener('pointercancel', () => { touchStart = null; });

startButton.addEventListener('click', () => state === 'paused' ? togglePause() : start());
pauseButton.addEventListener('click', togglePause);
restartButton.addEventListener('click', () => { reset(); start(); });
soundButton.addEventListener('click', () => {
  soundOn = !soundOn;
  localStorage.setItem('neon-snake-sound', soundOn ? 'on' : 'off');
  updateHud();
  beep(520, .05);
});

reset();
