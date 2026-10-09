// Render the client's supplied artwork with cover sizing and native pixel density.
const artwork = new Image();
const surfaces = [...document.querySelectorAll("[data-terrain]")];

function paint(canvas) {
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return;
  const density = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * density);
  canvas.height = Math.round(height * density);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return;
  context.fillStyle = "#eff0ee";
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!artwork.complete || !artwork.naturalWidth) return;
  const scale = Math.max(canvas.width / artwork.naturalWidth, canvas.height / artwork.naturalHeight);
  const renderedWidth = artwork.naturalWidth * scale;
  const renderedHeight = artwork.naturalHeight * scale;
  context.imageSmoothingQuality = "high";
  context.drawImage(artwork, (canvas.width - renderedWidth) / 2,
    (canvas.height - renderedHeight) / 2, renderedWidth, renderedHeight);
}

const observer = new ResizeObserver((entries) => entries.forEach(({ target }) => paint(target)));
surfaces.forEach((canvas) => observer.observe(canvas));
artwork.onload = () => surfaces.forEach(paint);
artwork.src = new URL("./assets/vitalini-halftone-bg.png", import.meta.url).href;
