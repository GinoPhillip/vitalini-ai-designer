export function normalizeRotation(value) {
  return ((Number(value) || 0) + 180) % 360 < 0
    ? (((Number(value) || 0) + 180) % 360 + 360) - 180
    : (((Number(value) || 0) + 180) % 360) - 180;
}

export function rotatedExtent(size, aspect, rotation) {
  const angle = rotation * Math.PI / 180;
  return { x: size * (Math.abs(Math.cos(angle)) + aspect * Math.abs(Math.sin(angle))) / 2,
    y: size * (Math.abs(Math.sin(angle)) + aspect * Math.abs(Math.cos(angle))) / 2 };
}

export function logoLocalPoint(point, rect, rotation) {
  const angle = -rotation * Math.PI / 180;
  const x = point.x - rect.centerX, y = point.y - rect.centerY;
  return { x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) };
}
