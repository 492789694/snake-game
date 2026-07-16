const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const scoreEl = document.querySelector('#score');
const movesEl = document.querySelector('#moves');
const bestEl = document.querySelector('#best');
const progressBar = document.querySelector('#progressBar');
const overlay = document.querySelector('#overlay');
const overlayTag = document.querySelector('#overlayTag');
const overlayTitle = document.querySelector('#overlayTitle');
const overlayText = document.querySelector('#overlayText');
const startButton = document.querySelector('#startButton');
const comboEl = document.querySelector('#combo');
const soundButton = document.querySelector('#soundButton');

const SIZE = 8;
const CELL = canvas.width / SIZE;
const TYPES = 6;
const TARGET = 3000;
const START_MOVES = 25;
const COLORS = ['#ff6f91', '#ffd85a', '#66d9ff', '#9c7cff', '#63e49a', '#ff9c52'];
let board = [];
let selected = null;
let score = 0;
let moves = START_MOVES;
let busy = false;
let playing = false;
let soundOn = localStorage.getItem('match-sound') !== 'off';
let best = Number(localStorage.getItem('match-best') || 0);

function makeBoard() {
  board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      let type;
      do type = Math.floor(Math.random() * TYPES);
      while ((col >= 2 && board[row][col - 1] === type && board[row][col - 2] === type) || (row >= 2 && board[row - 1][col] === type && board[row - 2][col] === type));
      board[row][col] = type;
    }
  }
  if (!findPossibleMove()) makeBoard();
}

function startGame() {
  score = 0;
  moves = START_MOVES;
  selected = null;
  playing = true;
  busy = false;
  makeBoard();
  updateHud();
  draw();
  overlay.classList.add('hidden');
}

function draw(highlights = []) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#151c18';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const type = board[row]?.[col];
      if (type === null || type === undefined) continue;
      const x = col * CELL;
      const y = row * CELL;
      ctx.fillStyle = (row + col) % 2 ? '#18211c' : '#1b251f';
      ctx.fillRect(x, y, CELL, CELL);
      drawJelly(x + CELL / 2, y + CELL / 2, type, selected?.row === row && selected?.col === col, highlights.some(item => item.row === row && item.col === col));
    }
  }
}

function drawJelly(x, y, type, isSelected, isHint) {
  const radius = CELL * .33;
  ctx.save();
  ctx.translate(x, y);
  if (isSelected || isHint) {
    ctx.strokeStyle = isHint ? '#ffffff' : '#c9ff5d';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.shadowColor = COLORS[type];
  ctx.shadowBlur = 12;
  ctx.fillStyle = COLORS[type];
  ctx.beginPath();
  if (type === 0) {
    ctx.arc(0, 1, radius, 0, Math.PI * 2);
  } else if (type === 1) {
    roundedPath(-radius, -radius, radius * 2, radius * 2, 13);
  } else if (type === 2) {
    ctx.moveTo(0, -radius - 2); ctx.lineTo(radius + 2, 0); ctx.lineTo(0, radius + 2); ctx.lineTo(-radius - 2, 0); ctx.closePath();
  } else if (type === 3) {
    polygon(0, 0, radius + 2, 6);
  } else if (type === 4) {
    ctx.arc(0, 0, radius, Math.PI, 0); ctx.lineTo(radius * .72, radius * .72); ctx.quadraticCurveTo(0, radius * 1.12, -radius * .72, radius * .72); ctx.closePath();
  } else {
    polygon(0, 0, radius + 2, 5);
  }
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,.48)';
  ctx.beginPath(); ctx.ellipse(-radius * .32, -radius * .35, radius * .22, radius * .13, -.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function roundedPath(x, y, width, height, radius) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, width, height, radius);
  else ctx.rect(x, y, width, height);
}

function polygon(x, y, radius, sides) {
  ctx.moveTo(x, y - radius);
  for (let i = 1; i < sides; i++) {
    const angle = -Math.PI / 2 + i * Math.PI * 2 / sides;
    ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  }
  ctx.closePath();
}

function boardPosition(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return { col: Math.floor((clientX - rect.left) / rect.width * SIZE), row: Math.floor((clientY - rect.top) / rect.height * SIZE) };
}

function handlePick(cell) {
  if (!playing || busy || cell.row < 0 || cell.row >= SIZE || cell.col < 0 || cell.col >= SIZE) return;
  if (!selected) {
    selected = cell;
    draw();
    beep(360, .025);
    return;
  }
  if (selected.row === cell.row && selected.col === cell.col) {
    selected = null;
    draw();
    return;
  }
  if (Math.abs(selected.row - cell.row) + Math.abs(selected.col - cell.col) !== 1) {
    selected = cell;
    draw();
    return;
  }
  trySwap(selected, cell);
}

async function trySwap(a, b) {
  busy = true;
  swap(a, b);
  selected = null;
  draw();
  await wait(160);
  if (!findMatches().length) {
    swap(a, b);
    draw();
    beep(130, .08);
    await wait(130);
    busy = false;
    return;
  }
  moves--;
  await resolveBoard();
  updateHud();
  busy = false;
  if (score >= TARGET || moves <= 0) finishGame();
  else if (!findPossibleMove()) shuffleBoard(false);
}

async function resolveBoard() {
  let chain = 0;
  let matches;
  while ((matches = findMatches()).length) {
    chain++;
    score += matches.length * 50 * chain;
    if (chain > 1) showCombo(chain);
    matches.forEach(({ row, col }) => board[row][col] = null);
    draw();
    beep(500 + chain * 90, .06);
    updateHud();
    await wait(180);
    collapse();
    draw();
    await wait(190);
  }
  best = Math.max(best, score);
  localStorage.setItem('match-best', best);
}

function findMatches() {
  const found = new Map();
  const add = (row, col) => found.set(`${row}-${col}`, { row, col });
  for (let row = 0; row < SIZE; row++) {
    let start = 0;
    for (let col = 1; col <= SIZE; col++) {
      if (col < SIZE && board[row][col] === board[row][start] && board[row][col] !== null) continue;
      if (col - start >= 3 && board[row][start] !== null) for (let x = start; x < col; x++) add(row, x);
      start = col;
    }
  }
  for (let col = 0; col < SIZE; col++) {
    let start = 0;
    for (let row = 1; row <= SIZE; row++) {
      if (row < SIZE && board[row][col] === board[start][col] && board[row][col] !== null) continue;
      if (row - start >= 3 && board[start][col] !== null) for (let y = start; y < row; y++) add(y, col);
      start = row;
    }
  }
  return [...found.values()];
}

function collapse() {
  for (let col = 0; col < SIZE; col++) {
    const values = [];
    for (let row = SIZE - 1; row >= 0; row--) if (board[row][col] !== null) values.push(board[row][col]);
    for (let row = SIZE - 1, i = 0; row >= 0; row--, i++) board[row][col] = i < values.length ? values[i] : Math.floor(Math.random() * TYPES);
  }
}

function swap(a, b) {
  [board[a.row][a.col], board[b.row][b.col]] = [board[b.row][b.col], board[a.row][a.col]];
}

function findPossibleMove() {
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      for (const delta of [{ row: 0, col: 1 }, { row: 1, col: 0 }]) {
        const next = { row: row + delta.row, col: col + delta.col };
        if (next.row >= SIZE || next.col >= SIZE) continue;
        const here = { row, col };
        swap(here, next);
        const valid = findMatches().length > 0;
        swap(here, next);
        if (valid) return [here, next];
      }
    }
  }
  return null;
}

function showHint() {
  if (!playing || busy) return;
  const move = findPossibleMove();
  if (!move) return shuffleBoard(false);
  draw(move);
  setTimeout(() => draw(), 900);
}

function shuffleBoard(costsMove = true) {
  if (!playing || busy) return;
  if (costsMove && moves > 1) moves--;
  makeBoard();
  selected = null;
  draw();
  updateHud();
  beep(250, .05);
}

function finishGame() {
  playing = false;
  const won = score >= TARGET;
  showOverlay(won ? '挑战成功' : '步数用完', won ? '漂亮的连击！' : `本局 ${score} 分`, won ? `你用 ${START_MOVES - moves} 步完成了目标。` : '再试一次，四连和连续消除得分更高。', '再玩一局');
}

function showOverlay(tag, title, text, button) {
  overlayTag.textContent = tag;
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  startButton.textContent = button;
  overlay.classList.remove('hidden');
}

function showCombo(chain) {
  comboEl.textContent = `${chain} 连击!`;
  comboEl.classList.remove('show');
  void comboEl.offsetWidth;
  comboEl.classList.add('show');
}

function updateHud() {
  scoreEl.textContent = String(score).padStart(4, '0');
  movesEl.textContent = moves;
  bestEl.textContent = String(Math.max(best, score)).padStart(4, '0');
  progressBar.style.width = `${Math.min(100, score / TARGET * 100)}%`;
  soundButton.textContent = `音效 ${soundOn ? '开' : '关'}`;
}

function beep(frequency, duration) {
  if (!soundOn) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const audio = new AudioContext();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(.035, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + duration);
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

canvas.addEventListener('pointerup', event => handlePick(boardPosition(event.clientX, event.clientY)));
startButton.addEventListener('click', startGame);
document.querySelector('#hintButton').addEventListener('click', showHint);
document.querySelector('#shuffleButton').addEventListener('click', () => shuffleBoard(true));
document.querySelector('#restartButton').addEventListener('click', startGame);
soundButton.addEventListener('click', () => {
  soundOn = !soundOn;
  localStorage.setItem('match-sound', soundOn ? 'on' : 'off');
  updateHud();
  beep(440, .04);
});

makeBoard();
updateHud();
draw();
