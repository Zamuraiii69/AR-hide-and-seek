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
      context.fillStyle = tap.hit ? 'rgba(29, 138, 76, .82)' : 'rgba(217, 58, 48, .78)';
      context.fill();
      context.lineWidth = Math.max(2, radius * .22);
      context.strokeStyle = 'rgba(255, 255, 255, .9)';
      context.stroke();
    }
  }
  canvas.hidden = false;
}

function renderPoseStats(poses) {
  const table = $('pose-stats-table');
  const empty = $('pose-stats-empty');
  if (!poses.length) {
    empty.hidden = false;
    table.hidden = true;
    return;
  }
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = '';
  for (const pose of poses) {
    const row = document.createElement('tr');
    const cells = [
      pose.poseId,
      pose.attempts,
      pose.hides,
      `${Math.round(pose.foundRate * 100)}%`,
      pose.avgTaps === null ? '-' : pose.avgTaps,
    ];
    for (const value of cells) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    }
    tbody.appendChild(row);
  }
  table.hidden = false;
  empty.hidden = true;
}

// Independent of ?hide= — always shows every pose's global aggregate, so it
// fetches on its own rather than riding along with boot()'s hide-specific
// calls (a bad/missing ?hide= must not prevent this table from rendering).
async function loadPoseStats() {
  try {
    const { poses } = await getJSON('/api/stats/poses');
    renderPoseStats(poses);
  } catch (error) {
    $('pose-stats-status').textContent = error.message;
  }
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
loadPoseStats();
