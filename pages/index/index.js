const GRID = 20;
const START_DELAY = 145;

Page({
  data: {
    score: 0, scoreText: '000', highScoreText: '000', speedText: '1.0x',
    soundOn: true, paused: false, showOverlay: true,
    overlayTag: '准备好了吗？', overlayTitle: '点击开始游戏',
    overlayText: '点击蛇头四周控制方向，吃掉能量果实。', overlayButton: '开始游戏'
  },

  onLoad() {
    this.highScore = Number(wx.getStorageSync('snake-high-score') || 0);
    this.soundOn = wx.getStorageSync('snake-sound') !== 'off';
    this.setData({ highScoreText: this.pad(this.highScore), soundOn: this.soundOn });
  },

  onReady() {
    const query = this.createSelectorQuery();
    query.select('#game').fields({ node: true, size: true, rect: true }).exec(result => {
      const { node, width, height, left, top } = result[0];
      const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio;
      node.width = width * dpr;
      node.height = height * dpr;
      this.canvas = node;
      this.ctx = node.getContext('2d');
      this.ctx.scale(dpr, dpr);
      this.size = width;
      this.cell = width / GRID;
      this.boardRect = { left, top, width, height };
      this.reset();
    });
  },

  onUnload() { clearTimeout(this.timer); },
  onHide() { if (this.state === 'playing') this.pause(); },

  reset() {
    clearTimeout(this.timer);
    this.snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    this.direction = { x: 1, y: 0 };
    this.queued = this.direction;
    this.score = 0;
    this.state = 'ready';
    this.placeFood();
    this.updateHud();
    this.draw();
    this.setData({ paused: false, showOverlay: true, overlayTag: '准备好了吗？', overlayTitle: '点击开始游戏', overlayText: '点击蛇头四周控制方向，吃掉能量果实。', overlayButton: '开始游戏' });
  },

  startGame() {
    if (!this.ctx) return;
    if (this.state === 'paused') return this.resume();
    if (this.state === 'gameover') this.reset();
    this.state = 'playing';
    this.setData({ showOverlay: false, paused: false });
    this.schedule();
  },

  restart() { this.reset(); this.startGame(); },
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.tick(), Math.max(58, START_DELAY - this.score * 2.5)); },

  tick() {
    if (this.state !== 'playing') return;
    this.direction = this.queued;
    const head = { x: this.snake[0].x + this.direction.x, y: this.snake[0].y + this.direction.y };
    const hitWall = head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID;
    const hitSelf = this.snake.some(part => part.x === head.x && part.y === head.y);
    if (hitWall || hitSelf) return this.endGame();
    this.snake.unshift(head);
    if (head.x === this.food.x && head.y === this.food.y) {
      this.score += 10;
      this.highScore = Math.max(this.highScore, this.score);
      wx.setStorageSync('snake-high-score', this.highScore);
      this.vibrate();
      this.placeFood();
      this.updateHud();
    } else this.snake.pop();
    this.draw();
    this.schedule();
  },

  placeFood() {
    do this.food = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
    while (this.snake && this.snake.some(part => part.x === this.food.x && part.y === this.food.y));
  },

  setDirection(next) {
    if (next.x + this.direction.x === 0 && next.y + this.direction.y === 0) return;
    this.queued = next;
    if (this.state === 'ready') this.startGame();
  },

  tapDirection(event) {
    const map = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
    this.setDirection(map[event.currentTarget.dataset.direction]);
  },

  onTouchStart(event) { const t = event.changedTouches[0]; this.touchStart = { x: t.clientX, y: t.clientY }; },
  onTouchEnd(event) {
    if (!this.touchStart || this.data.showOverlay) return;
    const t = event.changedTouches[0];
    const dx = t.clientX - this.touchStart.x;
    const dy = t.clientY - this.touchStart.y;
    this.touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 15) {
      this.setDirectionFromTap(t.clientX, t.clientY);
      return;
    }
    this.setDirection(Math.abs(dx) > Math.abs(dy) ? { x: dx > 0 ? 1 : -1, y: 0 } : { x: 0, y: dy > 0 ? 1 : -1 });
  },

  setDirectionFromTap(clientX, clientY) {
    if (!this.boardRect || !this.snake?.length || this.state === 'paused' || this.state === 'gameover') return;
    const rect = this.boardRect;
    const headX = rect.left + (this.snake[0].x + 0.5) * rect.width / GRID;
    const headY = rect.top + (this.snake[0].y + 0.5) * rect.height / GRID;
    const dx = clientX - headX;
    const dy = clientY - headY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < rect.width / GRID) return;
    this.setDirection(Math.abs(dx) > Math.abs(dy) ? { x: dx > 0 ? 1 : -1, y: 0 } : { x: 0, y: dy > 0 ? 1 : -1 });
  },

  togglePause() { if (this.state === 'playing') this.pause(); else if (this.state === 'paused') this.resume(); else this.startGame(); },
  pause() { this.state = 'paused'; clearTimeout(this.timer); this.setData({ paused: true, showOverlay: true, overlayTag: '游戏暂停', overlayTitle: '喘口气', overlayText: '准备好后继续冲击最高纪录。', overlayButton: '继续游戏' }); },
  resume() { this.state = 'playing'; this.setData({ paused: false, showOverlay: false }); this.schedule(); },

  endGame() {
    this.state = 'gameover';
    wx.vibrateLong?.();
    this.draw(true);
    this.setData({ showOverlay: true, overlayTag: '本局结束', overlayTitle: `得分 ${this.score}`, overlayText: this.score === this.highScore && this.score > 0 ? '新纪录！分享给好友来挑战吧。' : '调整路线，再来一局。', overlayButton: '再玩一次' });
  },

  updateHud() { this.setData({ score: this.score, scoreText: this.pad(this.score), highScoreText: this.pad(this.highScore), speedText: `${(START_DELAY / Math.max(58, START_DELAY - this.score * 2.5)).toFixed(1)}x` }); },
  pad(value) { return String(value).padStart(3, '0'); },
  toggleSound() { this.soundOn = !this.soundOn; wx.setStorageSync('snake-sound', this.soundOn ? 'on' : 'off'); this.setData({ soundOn: this.soundOn }); },
  vibrate() { if (this.soundOn) wx.vibrateShort?.({ type: 'light' }); },

  roundRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  },

  draw(crashed = false) {
    const ctx = this.ctx, cell = this.cell;
    ctx.fillStyle = '#09140f'; ctx.fillRect(0, 0, this.size, this.size);
    ctx.strokeStyle = 'rgba(182,255,59,.055)'; ctx.lineWidth = 1;
    for (let i = 1; i < GRID; i++) { ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, this.size); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(this.size, i * cell); ctx.stroke(); }
    ctx.save(); ctx.shadowColor = '#ff5b78'; ctx.shadowBlur = 15; ctx.fillStyle = '#ff5b78'; this.roundRect(ctx, this.food.x * cell + 5, this.food.y * cell + 5, cell - 10, cell - 10, 7); ctx.fill(); ctx.restore();
    this.snake.forEach((part, index) => { const gap = index ? 4 : 2; ctx.save(); ctx.shadowColor = index ? '#54f9b0' : '#b6ff3b'; ctx.shadowBlur = index ? 5 : 12; ctx.fillStyle = crashed && !index ? '#ff5b78' : index ? '#54f9b0' : '#b6ff3b'; this.roundRect(ctx, part.x * cell + gap, part.y * cell + gap, cell - gap * 2, cell - gap * 2, 6); ctx.fill(); ctx.restore(); });
  },

  onShareAppMessage() {
    return { title: this.score ? `我在霓虹贪吃蛇拿到 ${this.score} 分，来挑战我！` : '霓虹贪吃蛇，点击即玩！', path: '/pages/index/index?from=share' };
  },
  onShareTimeline() { return { title: `霓虹贪吃蛇｜我的最高分 ${this.highScore || 0}，等你挑战`, query: 'from=timeline' }; }
});
