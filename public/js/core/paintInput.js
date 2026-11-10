// Both surfaces feed model UVs into one brush and one paint canvas.
export function createPaintStroke(brush, isBody) {
  let owner = null;
  let drawing = false;
  function sample(uv) {
    if (!uv || !isBody(uv.x, uv.y)) {
      brush.end(); drawing = false;
      return;
    }
    if (drawing) brush.move(uv);
    else { brush.start(uv); drawing = true; }
  }
  return {
    begin(source, uv) { brush.end(); drawing = false; owner = source; sample(uv); },
    move(source, uv) { if (owner === source) sample(uv); },
    end(source) {
      if (source !== undefined && source !== owner) return;
      brush.end(); drawing = false; owner = null;
    },
  };
}

// Inverse of localToMeshUV; independent of the live tracking matrix.
export function meshUVToMarkerUV(uv, mesh, aspect, out = {}) {
  const x = (uv.x - 0.5) * mesh.scale.x;
  const y = (uv.y - 0.5) * mesh.scale.y;
  const c = Math.cos(mesh.rotation.z), s = Math.sin(mesh.rotation.z);
  out.x = mesh.position.x + x * c - y * s + 0.5;
  out.y = (mesh.position.y + x * s + y * c) / aspect + 0.5;
  return out;
}

// Canvas affine transform: marker image pixels -> upright model preview pixels.
export function markerPreviewTransform(mesh, aspect, width, height, imageWidth, imageHeight) {
  const c = Math.cos(mesh.rotation.z), s = Math.sin(mesh.rotation.z);
  const x = -0.5 - mesh.position.x, y = aspect / 2 - mesh.position.y;
  return [
    width * c / mesh.scale.x / imageWidth,
    height * s / mesh.scale.y / imageWidth,
    -width * s * aspect / mesh.scale.x / imageHeight,
    height * c * aspect / mesh.scale.y / imageHeight,
    width * (0.5 + (c * x + s * y) / mesh.scale.x),
    height * (0.5 - (-s * x + c * y) / mesh.scale.y),
  ];
}
