// A warped, two-dimensional elevation field: viewed from above, never in profile.
export function mapElevation(x, y) {
  const u = x + .048 * Math.sin(y * 9 + x * 3) + .018 * Math.sin(y * 21 - x * 5);
  const v = y + .055 * Math.cos(x * 8 - y * 4) + .016 * Math.sin(x * 19 + y * 7);
  const hill = (cx, cy, sx, sy, height) => height * Math.exp(-(((u - cx) / sx) ** 2 + ((v - cy) / sy) ** 2));
  return hill(.12, .66, .24, .33, 1.22)
    + hill(.83, .13, .23, .32, 1.1)
    + hill(.91, .86, .32, .29, 1.16)
    + hill(-.10, -.16, .30, .29, .9)
    - hill(.49, .49, .21, .33, .38)
    + .11 * Math.sin(u * 8 + v * 5) + .045 * Math.cos(v * 16 - u * 5);
}

// Marching squares, stitched by shared grid edges into continuous contour paths.
export function contoursAt(field, dx, dy, level) {
  const rows = field.length - 1, cols = field[0].length - 1;
  const vertices = new Map(), neighbors = new Map();
  function connect(a, b) {
    for (const [point, other] of [[a, b], [b, a]]) {
      vertices.set(point.key, point.position);
      if (!neighbors.has(point.key)) neighbors.set(point.key, []);
      neighbors.get(point.key).push(other.key);
    }
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const values = [field[y][x], field[y][x + 1], field[y + 1][x + 1], field[y + 1][x]];
    const mask = values.reduce((value, corner, index) => value | (corner >= level ? 1 << index : 0), 0);
    if (mask === 0 || mask === 15) continue;
    const positions = [[x * dx, y * dy], [(x + 1) * dx, y * dy], [(x + 1) * dx, (y + 1) * dy], [x * dx, (y + 1) * dy]];
    const keys = [`h:${x}:${y}`, `v:${x + 1}:${y}`, `h:${x}:${y + 1}`, `v:${x}:${y}`];
    const crossings = [];
    for (let edge = 0; edge < 4; edge++) {
      const next = (edge + 1) % 4;
      if ((values[edge] >= level) === (values[next] >= level)) continue;
      const fraction = (level - values[edge]) / (values[next] - values[edge]);
      crossings.push({ key: keys[edge], position: [
        positions[edge][0] + fraction * (positions[next][0] - positions[edge][0]),
        positions[edge][1] + fraction * (positions[next][1] - positions[edge][1])
      ] });
    }
    if (crossings.length === 2) connect(crossings[0], crossings[1]);
    else if (crossings.length === 4) {
      const centerHigh = values.reduce((sum, value) => sum + value, 0) / 4 >= level;
      if ((mask === 5) === centerHigh) {
        connect(crossings[0], crossings[1]); connect(crossings[2], crossings[3]);
      } else {
        connect(crossings[0], crossings[3]); connect(crossings[1], crossings[2]);
      }
    }
  }
  const visited = new Set(), paths = [];
  function trace(start) {
    const path = [];
    let current = start, previous = null;
    while (current && !visited.has(current)) {
      path.push(vertices.get(current)); visited.add(current);
      const next = neighbors.get(current).find((key) => key !== previous);
      if (next === start) { path.push(vertices.get(start)); break; }
      previous = current; current = next;
    }
    if (path.length > 1) paths.push(path);
  }
  // Open paths first, then closed loops, so edge contours never split in two.
  for (const [key, adjacent] of neighbors) if (adjacent.length === 1 && !visited.has(key)) trace(key);
  for (const key of neighbors.keys()) if (!visited.has(key)) trace(key);
  return paths;
}

export function pointOnContour(path, distance, lengths) {
  let segment = 0;
  while (segment < lengths.length - 1 && lengths[segment + 1] < distance) segment++;
  if (segment >= path.length - 1) return null;
  const a = path[segment], b = path[segment + 1];
  const span = lengths[segment + 1] - lengths[segment];
  const fraction = span ? (distance - lengths[segment]) / span : 0;
  return [a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1])];
}

// Reserve padded, rotated wordmarks so neighboring contour bands cannot collide.
export function createWordmarkSpacing(cellSize = 140) {
  const cells = new Map();
  return (x, y, width, height, angle, padding = 5) => {
    const c = Math.cos(angle), s = Math.sin(angle);
    const box = { x, y, axes: [[c, s], [-s, c]], half: [width / 2 + padding, height / 2 + padding] };
    const rx = Math.abs(c) * box.half[0] + Math.abs(s) * box.half[1];
    const ry = Math.abs(s) * box.half[0] + Math.abs(c) * box.half[1];
    const keys = [], neighbors = new Set();
    for (let row = Math.floor((y - ry) / cellSize); row <= Math.floor((y + ry) / cellSize); row++) {
      for (let col = Math.floor((x - rx) / cellSize); col <= Math.floor((x + rx) / cellSize); col++) {
        const key = `${col}:${row}`;
        keys.push(key);
        for (const other of cells.get(key) || []) neighbors.add(other);
      }
    }
    const radius = (rect, axis) => rect.half.reduce((sum, half, i) =>
      sum + half * Math.abs(rect.axes[i][0] * axis[0] + rect.axes[i][1] * axis[1]), 0);
    for (const other of neighbors) {
      const separated = [...box.axes, ...other.axes].some((axis) =>
        Math.abs((x - other.x) * axis[0] + (y - other.y) * axis[1]) >= radius(box, axis) + radius(other, axis));
      if (!separated) return false;
    }
    for (const key of keys) {
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(box);
    }
    return true;
  };
}
