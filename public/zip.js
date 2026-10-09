// ZIP store records: images are already compressed. No CDN or runtime dependency.
// Format reference: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
const encoder = new TextEncoder();
const table = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

export async function createZip(files, date = new Date()) {
  if (!files.length || files.length > 65535) throw new Error("Invalid ZIP file count.");
  const parts = [], directory = [], names = new Set();
  let offset = 0, directorySize = 0;
  const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
  const day = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  for (const file of files) {
    if (typeof file.name !== "string" || file.name.startsWith("/") || file.name.includes("\\") ||
        file.name.includes("\0") || file.name.split("/").some((part) => !part || part === "." || part === "..") || names.has(file.name)) {
      throw new Error("Invalid or duplicate ZIP filename.");
    }
    names.add(file.name);
    const name = encoder.encode(file.name);
    if (name.length > 65535) throw new Error("ZIP filename too long.");
    const bytes = typeof file.data === "string" ? encoder.encode(file.data) :
      file.data instanceof Uint8Array ? file.data : new Uint8Array(await file.data.arrayBuffer());
    if (offset + bytes.length > 96 * 1024 * 1024) throw new Error("Package too large. Please contact Vitalini support.");
    const crc = crc32(bytes);
    const local = new Uint8Array(30), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true);
    l.setUint16(10, time, true); l.setUint16(12, day, true); l.setUint32(14, crc, true);
    l.setUint32(18, bytes.length, true); l.setUint32(22, bytes.length, true); l.setUint16(26, name.length, true);
    const central = new Uint8Array(46), c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(12, time, true); c.setUint16(14, day, true); c.setUint32(16, crc, true);
    c.setUint32(20, bytes.length, true); c.setUint32(24, bytes.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    parts.push(local, name, bytes); directory.push(central, name);
    offset += local.length + name.length + bytes.length;
    directorySize += central.length + name.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: "application/zip" });
}
