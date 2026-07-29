function pixel(uv, size) { return { x: uv.x * size, y: (1 - uv.y) * size }; }

export function createBrush(ctx, size, markDirty) {
  let last = null;
  let color = '#526a45';
  let radius = 16;
  let soft = false;
  function stamp(point) {
    const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.65, color);
    gradient.addColorStop(1, `${color}00`);
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill();
  }
  function setHardStyle() { ctx.strokeStyle = color; ctx.lineWidth = radius * 2; ctx.lineCap = 'round'; }
  return {
    setColor(value) { color = value; }, setRadius(value) { radius = Number(value); }, setSoft(value) { soft = value; },
    start(uv) { last = pixel(uv, size); if (soft) stamp(last); else { setHardStyle(); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(last.x, last.y); ctx.stroke(); } markDirty(); },
    move(uv) { if (!last) return; const next = pixel(uv, size); if (soft) { const d = Math.hypot(next.x - last.x, next.y - last.y); if (d === 0) { stamp(next); last = next; markDirty(); return; } for (let n = 0; n <= d; n += Math.max(1, radius * .25)) stamp({ x: last.x + (next.x - last.x) * n / d, y: last.y + (next.y - last.y) * n / d }); } else { setHardStyle(); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(next.x, next.y); ctx.stroke(); } last = next; markDirty(); },
    end() { last = null; },
  };
}
