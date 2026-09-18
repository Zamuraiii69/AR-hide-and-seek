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

// 'custom_1' -> 'Custom 1'; built-in ids ('human_a', legacy 'human_default')
// render as-is — the table aggregates by raw pose id (R1 in the design doc:
// custom_N merges across markers), so it has no pose list to look a label up in.
function poseLabel(poseId) {
  const match = /^custom_(\d+)$/.exec(poseId);
  return match ? `Custom ${match[1]}` : poseId;
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
      poseLabel(pose.poseId),
      pose.rounds,
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

// Scoped to the hide's own marker when we know it: an unscoped table sitting
// under one hide's numbers reads as a contradiction, because it silently sums
// every marker ever played. Falls back to the global view when the marker is
// unknown, so a bad/missing ?hide= still renders something.
async function loadPoseStats(markerId) {
  const scoped = Number.isInteger(markerId) && markerId > 0;
  $('pose-stats-scope').textContent = scoped ? 'เฉพาะ marker ของที่ซ่อนนี้' : 'ทุก marker';
  try {
    const { poses } = await getJSON(`/api/stats/poses${scoped ? `?marker=${markerId}` : ''}`);
    renderPoseStats(poses);
  } catch (error) {
    $('pose-stats-status').textContent = error.message;
  }
}

// Shared with the pose table so both read the same hide without fetching twice,
// while each still handles its own failure.
const hidePromise = Number.isInteger(hideId) && hideId > 0
  ? getJSON(`/api/hides/${hideId}`)
  : Promise.reject(new Error('ลิงก์นี้ไม่มีรหัสที่ซ่อน (?hide=)'));

async function boot() {
  if (!Number.isInteger(hideId) || hideId < 1) throw new Error('ลิงก์นี้ไม่มีรหัสที่ซ่อน (?hide=)');
  $('hunt-link').href = `/seek.html?hide=${hideId}`;
  $('hunt-link').textContent = 'เปิดการค้นหา';

  const [hide, analytics] = await Promise.all([
    hidePromise,
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
hidePromise.then((hide) => hide.markerId, () => null).then(loadPoseStats);
