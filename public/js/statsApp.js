import { getJSON } from './core/api.js';

const $ = (id) => document.getElementById(id);
const hideId = Number(new URLSearchParams(location.search).get('hide'));

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('โหลดรูป marker ไม่สำเร็จ'));
    image.src = url;
  });
}

function drawHeatmap(image, seeks) {
  const canvas = $('heatmap');
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, width, height);

  const radius = Math.max(5, Math.round(Math.min(width, height) * 0.012));
  for (const seek of seeks) {
    for (const tap of seek.taps || []) {
      if (!Number.isFinite(tap.u) || !Number.isFinite(tap.v)) continue;
      context.beginPath();
      context.arc(tap.u * width, (1 - tap.v) * height, radius, 0, Math.PI * 2);
      context.fillStyle = tap.hit ? 'rgba(70, 209, 126, .82)' : 'rgba(255, 107, 99, .72)';
      context.fill();
      context.lineWidth = Math.max(2, radius * .22);
      context.strokeStyle = 'rgba(255, 255, 255, .9)';
      context.stroke();
    }
  }
  canvas.hidden = false;
}

async function boot() {
  if (!Number.isInteger(hideId) || hideId < 1) throw new Error('ลิงก์นี้ไม่มีรหัสที่ซ่อน (?hide=)');
  $('hunt-link').href = `/seek.html?hide=${hideId}`;
  $('hunt-link').textContent = 'เปิดการค้นหา';

  const [hide, analytics] = await Promise.all([
    getJSON(`/api/hides/${hideId}`),
    getJSON(`/api/hides/${hideId}/seeks`),
  ]);
  const { attempts, found, foundRate, avgTaps } = analytics.stats;
  $('subtitle').textContent = `Hide #${hideId} · แสดง ${analytics.seeks.length} attempts ล่าสุด (สูงสุด 200)`;
  $('attempts').textContent = attempts;
  $('found').textContent = found;
  $('found-rate').textContent = `${Math.round(foundRate * 100)}%`;
  $('avg-taps').textContent = avgTaps === null ? '-' : avgTaps;

  if (!hide.marker.imageUrl) throw new Error('ที่ซ่อนนี้ไม่มีรูป marker สำหรับวาด heatmap');
  const taps = analytics.seeks.reduce((count, seek) => count + (seek.taps?.length || 0), 0);
  if (!taps) {
    $('empty').hidden = false;
    return;
  }
  drawHeatmap(await loadImage(hide.marker.imageUrl), analytics.seeks);
}

boot().catch((error) => {
  $('subtitle').textContent = 'เปิดสถิติไม่สำเร็จ';
  $('status').textContent = error.message;
});
