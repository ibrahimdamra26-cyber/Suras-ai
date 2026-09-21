/* Suras Modular Arcade Engine — js/game.js */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let score = 0, isRunning = false, keys = {};
let player = { x: 300, y: 350, w: 36, h: 36, speed: 6 };
let bullets = [], meteors = [];

window.addEventListener('keydown', e => { keys[e.code] = true; if(e.code === 'Space') shoot(); });
window.addEventListener('keyup', e => { keys[e.code] = false; });

function shoot() {
  if(!isRunning) return;
  bullets.push({ x: player.x + player.w/2 - 2, y: player.y, w: 4, h: 12, speed: 8 });
}

function spawnMeteor() {
  if(Math.random() < 0.04) {
    meteors.push({ x: Math.random() * (canvas.width - 30), y: -30, size: Math.random() * 20 + 15, speed: Math.random() * 2 + 1.5 });
  }
}

function update() {
  if(keys['ArrowLeft'] || keys['KeyA']) player.x = Math.max(0, player.x - player.speed);
  if(keys['ArrowRight'] || keys['KeyD']) player.x = Math.min(canvas.width - player.w, player.x + player.speed);

  spawnMeteor();

  for(let i = bullets.length - 1; i >= 0; i--) {
    bullets[i].y -= bullets[i].speed;
    if(bullets[i].y < 0) bullets.splice(i, 1);
  }

  for(let i = meteors.length - 1; i >= 0; i--) {
    meteors[i].y += meteors[i].speed;
    for(let j = bullets.length - 1; j >= 0; j--) {
      const b = bullets[j], m = meteors[i];
      if(b && m && b.x > m.x && b.x < m.x + m.size && b.y > m.y && b.y < m.y + m.size) {
        bullets.splice(j, 1);
        meteors.splice(i, 1);
        score += 10;
        document.getElementById('scoreDisplay').textContent = score;
        break;
      }
    }
    if(meteors[i] && meteors[i].y > canvas.height) meteors.splice(i, 1);
  }
}

function draw() {
  ctx.fillStyle = '#050711';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#8b5cf6';
  ctx.beginPath();
  ctx.moveTo(player.x + player.w/2, player.y);
  ctx.lineTo(player.x + player.w, player.y + player.h);
  ctx.lineTo(player.x, player.y + player.h);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#06b6d4';
  bullets.forEach(b => ctx.fillRect(b.x, b.y, b.w, b.h));

  ctx.fillStyle = '#ec4899';
  meteors.forEach(m => {
    ctx.beginPath();
    ctx.arc(m.x + m.size/2, m.y + m.size/2, m.size/2, 0, Math.PI*2);
    ctx.fill();
  });
}

function gameLoop() {
  if(isRunning) { update(); draw(); }
  requestAnimationFrame(gameLoop);
}

function startCurrentGame() { isRunning = true; }
function resetCurrentGame() { isRunning = false; score = 0; bullets = []; meteors = []; player.x = 300; draw(); }

draw();
gameLoop();