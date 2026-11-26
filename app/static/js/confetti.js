export function launchConfetti() {
  const canvas = document.getElementById("confetti-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ["#f59e0b", "#f43f5e", "#10b981", "#6366f1", "#fde68a"];
  const pieces = Array.from({ length: 110 }, () => ({
    x: canvas.width * (0.25 + Math.random() * 0.5),
    y: canvas.height * 0.45,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 14 - 4,
    size: 5 + Math.random() * 7,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * Math.PI * 2,
    vrot: (Math.random() - 0.5) * 0.25,
    life: 1,
  }));

  let frameId = 0;
  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of pieces) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.38;
      p.rot += p.vrot;
      p.life -= 0.012;
      if (p.life <= 0) continue;
      alive = true;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
      ctx.restore();
    }
    if (alive) {
      frameId = requestAnimationFrame(tick);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      cancelAnimationFrame(frameId);
    }
  }
  frameId = requestAnimationFrame(tick);
}
