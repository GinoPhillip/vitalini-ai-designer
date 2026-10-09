export function copyCamera(camera) {
  if (!camera || ![camera.position, camera.target].every((value) =>
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite))) return null;
  return { position: [...camera.position], target: [...camera.target] };
}

export function zoomCamera(camera, initialCamera, factor) {
  const current = copyCamera(camera), initial = copyCamera(initialCamera);
  if (!current || !initial || !Number.isFinite(factor) || factor <= 0) return null;
  const offset = current.position.map((value, index) => value - current.target[index]);
  const distance = Math.hypot(...offset);
  const initialDistance = Math.hypot(...initial.position.map((value, index) => value - initial.target[index]));
  if (distance < 1e-8 || initialDistance < 1e-8) return null;
  const nextDistance = Math.max(initialDistance * .42, Math.min(initialDistance * 2.8, distance * factor));
  return { position: current.target.map((value, index) => value + offset[index] * nextDistance / distance),
    target: [...current.target] };
}
