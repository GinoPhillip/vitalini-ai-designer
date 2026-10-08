// Flowing Vitalini microprint, composed procedurally from the brand wordmark.
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
      ink.fillStyle = "#31563d";
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
    paper.addColorStop(0, "#e3eee6");
    paper.addColorStop(.5, "#f4f6ef");
    paper.addColorStop(1, "#dfeadf");
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
    // Wordmarks form the mountain ridgelines themselves; there are no drawn lines.
    const ridge = (x) => {
      const u = x / w;
      const peak = (center, spread, height) => height * Math.exp(-(((u - center) / spread) ** 2));
      return h * (.73 - peak(.26, .14, .34) - peak(.57, .19, .52) - peak(.94, .14, .30))
        + 10 * Math.sin(u * 29);
    };
    const rowPitch = w < 600 ? 22 : 27;
    for (let row = 0; row < h / rowPitch + 2; row++) {
      const baseWidth = [30, 46, 64, 35, 86, 42][row % 6];
      let x = -100 - (row % 2 ? baseWidth / 2 : 0);
      while (x < w + 100) {
        const depth = row * rowPitch;
        const relief = Math.exp(-depth / (h * .55));
        const y = h * .73 + (ridge(x) - h * .73) * relief + depth + 6 * Math.sin(x / 120 + row * .3);
        const tangent = (ridge(x + 2) - ridge(x - 2)) / 4 * relief + .05 * Math.cos(x / 120 + row * .3);
        const width = baseWidth * (.88 + .18 * Math.sin(x / 180 + row * .4));
        const central = Math.exp(-(((x / w - .5) ** 2) / .07 + ((y / h - .5) ** 2) / .14));
        const caption = Math.exp(-((x / 340) ** 4 + ((y - 130) / 155) ** 4));
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.atan(tangent));
        ctx.globalAlpha = (.58 + .09 * Math.sin(row * .8)) * (1 - central * .25) * (1 - caption * .98);
        ctx.drawImage(this.wordmark, -width / 2, -width * ratio / 2, width, width * ratio);
        ctx.restore();
        x += width + (baseWidth < 35 ? 5 : 9);
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
