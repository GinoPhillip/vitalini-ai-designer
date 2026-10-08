// An overhead contour map whose paths are composed entirely of Vitalini microprint.
import { mapElevation, contoursAt, pointOnContour } from "./topography.js?v=20261008-3";
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");

class Terrain {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    if (!this.context) return;
    this.surface = document.createElement("canvas");
    this.wordmark = null;
    const logo = new Image();
    logo.onload = () => {
      const stamp = document.createElement("canvas");
      stamp.width = logo.naturalWidth;
      stamp.height = logo.naturalHeight;
      const ink = stamp.getContext("2d");
      ink.drawImage(logo, 0, 0);
      ink.globalCompositeOperation = "source-in";
      ink.fillStyle = "#3f505b";
      ink.fillRect(0, 0, stamp.width, stamp.height);
      this.wordmark = stamp;
      if (this.width) { this.build(); this.restart(); }
    };
    logo.src = new URL("./assets/vitalini-logo.png", import.meta.url).href;
    this.visible = false;
    this.lastFrame = 0;
    this.frame = 0;
    this.draw = this.draw.bind(this);
    this.resize = this.resize.bind(this);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(canvas);
    this.visibilityObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.restart();
    });
    this.visibilityObserver.observe(canvas);
    motionPreference.addEventListener("change", () => this.restart());
    document.addEventListener("visibilitychange", () => this.restart());
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    this.width = width;
    this.height = height;
    this.scale = Math.min(devicePixelRatio || 1, 2);
    for (const surface of [this.canvas, this.surface]) {
      surface.width = Math.round(width * this.scale);
      surface.height = Math.round(height * this.scale);
    }
    this.build();
    this.restart();
  }

  build() {
    const ctx = this.surface.getContext("2d");
    const w = this.width, h = this.height;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    const paper = ctx.createLinearGradient(0, 0, w, h);
    paper.addColorStop(0, "#e8edf0");
    paper.addColorStop(.5, "#f6f7f5");
    paper.addColorStop(1, "#e7edef");
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);
    this.drawMicroprint(ctx, w, h);
    let seed = 7351;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    ctx.fillStyle = "rgba(61,99,65,.035)";
    for (let i = 0; i < w * h / 180; i++) ctx.fillRect(random() * w, random() * h, .7, .7);
  }

  drawMicroprint(ctx, w, h) {
    if (!this.wordmark) return;
    const ratio = this.wordmark.height / this.wordmark.width;
    const cols = Math.max(55, Math.min(190, Math.round(w / 7)));
    const rows = Math.max(55, Math.min(150, Math.round(h / 7)));
    const dx = w / cols, dy = h / rows;
    const field = Array.from({ length: rows + 1 }, (_, row) =>
      Array.from({ length: cols + 1 }, (_, col) => mapElevation(col / cols, row / rows)));
    for (let level = 0; level < 29; level++) {
      const major = level % 4 === 0;
      const width = (major ? 36 : level % 2 ? 20 : 24) * (w < 600 ? .78 : 1);
      const pitch = width + (major ? 6 : 4);
      for (const path of contoursAt(field, dx, dy, -.22 + level * .05)) {
        const lengths = [0];
        for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
        const total = lengths.at(-1);
        if (total < pitch * 2) continue;
        const count = Math.floor(total / pitch);
        const spacing = total / count;
        for (let i = 0; i < count; i++) {
          const distance = (i + .5) * spacing;
          const [x, y] = pointOnContour(path, distance, lengths);
          const before = pointOnContour(path, Math.max(0, distance - width * .28), lengths);
          const after = pointOnContour(path, Math.min(total - .001, distance + width * .28), lengths);
          let angle = Math.atan2(after[1] - before[1], after[0] - before[0]);
          // Keep every wordmark readable regardless of the contour's winding.
          if (angle > Math.PI / 2) angle -= Math.PI;
          if (angle < -Math.PI / 2) angle += Math.PI;
          const central = Math.exp(-(((x / w - .5) ** 2) / .06 + ((y / h - .5) ** 2) / .16));
          const caption = Math.exp(-((x / Math.min(340, w * .72)) ** 4 + ((y - 130) / 150) ** 4));
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.globalAlpha = (major ? .58 : .34) * (1 - central * .50) * (1 - caption * .97);
          ctx.drawImage(this.wordmark, -width / 2, -width * ratio / 2, width, width * ratio);
          ctx.restore();
        }
      }
    }
  }

  restart() {
    cancelAnimationFrame(this.frame);
    if (!this.width) return;
    this.paint(0);
    if (this.visible && !document.hidden && !motionPreference.matches) this.frame = requestAnimationFrame(this.draw);
  }

  paint(time) {
    const ctx = this.context;
    const w = this.width, h = this.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.surface, 0, 0);
    if (motionPreference.matches) return;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    const x = w * (.45 + Math.sin(time / 28000) * .17);
    const light = ctx.createRadialGradient(x, h * .38, 0, x, h * .38, w * .7);
    light.addColorStop(0, "rgba(255,255,247,.20)");
    light.addColorStop(1, "rgba(255,255,247,0)");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, w, h);
  }

  draw(time) {
    if (!this.visible || document.hidden || motionPreference.matches) return;
    if (time - this.lastFrame > 80) { this.paint(time); this.lastFrame = time; }
    this.frame = requestAnimationFrame(this.draw);
  }
}

document.querySelectorAll("[data-terrain]").forEach((canvas) => new Terrain(canvas));
