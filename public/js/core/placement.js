const corners = (bbox) => [[bbox.u0, bbox.v0], [bbox.u0, bbox.v1], [bbox.u1, bbox.v0], [bbox.u1, bbox.v1]];

export function clampToMarker(mesh, aspect, bbox) {
  const c = Math.cos(mesh.rotation.z), s = Math.sin(mesh.rotation.z);
  const points = corners(bbox).map(([u, v]) => {
    const x = (u - 0.5) * mesh.scale.x, y = (v - 0.5) * mesh.scale.y;
    return { x: x * c - y * s, y: x * s + y * c };
  });
  const minX = Math.min(...points.map((p) => p.x)), maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)), maxY = Math.max(...points.map((p) => p.y));
  const left = -0.5 - minX, right = 0.5 - maxX, bottom = -aspect / 2 - minY, top = aspect / 2 - maxY;
  const fits = left <= right && bottom <= top;
  mesh.position.x = fits ? Math.min(right, Math.max(left, mesh.position.x)) : 0;
  mesh.position.y = fits ? Math.min(top, Math.max(bottom, mesh.position.y)) : 0;
  return fits;
}

export function createPlacement(mesh, aspect, bbox) {
  let grab = null;
  return {
    start(point) { grab = { x: mesh.position.x - point.x, y: mesh.position.y - point.y }; },
    move(point) { if (!grab) return null; mesh.position.set(point.x + grab.x, point.y + grab.y, mesh.position.z); return clampToMarker(mesh, aspect, bbox); },
    clamp() { return clampToMarker(mesh, aspect, bbox); },
    end() { grab = null; },
  };
}
