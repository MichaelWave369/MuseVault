/**
 * Small ZIP writer/reader for MuseVault's own uncompressed (method 0) archives.
 * Deliberately does not attempt to unpack arbitrary ZIP formats, ZIP64, encrypted
 * entries, symlinks, data descriptors, or compressed methods.
 * No third-party ZIP runtime is required.
 */
const LIMIT = 60 * 1024 * 1024;
const ENTRY_LIMIT = 800;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function u16(view: DataView, offset: number) { return view.getUint16(offset, true); }
function u32(view: DataView, offset: number) { return view.getUint32(offset, true); }
function put16(view: DataView, offset: number, value: number) { view.setUint16(offset, value, true); }
function put32(view: DataView, offset: number, value: number) { view.setUint32(offset, value, true); }
function allowedPath(path: string): boolean {
  return path === 'manifest.json' || /^files\/[a-zA-Z0-9_-]{1,100}\/[a-zA-Z0-9_-]{1,100}$/.test(path);
}
type Entry = { name: string; nameBytes: Uint8Array; body: Uint8Array; crc: number; offset: number };

export function zipStored(entries: Record<string, Uint8Array>): Uint8Array {
  const names = Object.keys(entries);
  if (!names.length || names.length > ENTRY_LIMIT) throw new Error('Too many backup entries.');
  const list: Entry[] = [];
  let localSize = 0;
  let centralSize = 0;
  for (const name of names) {
    if (!allowedPath(name)) throw new Error('Invalid backup path.');
    const nameBytes = encoder.encode(name);
    const body = entries[name];
    if (nameBytes.length > 65535) throw new Error('ZIP entry name is too long.');
    list.push({ name, nameBytes, body, crc: crc32(body), offset: localSize });
    localSize += 30 + nameBytes.length + body.length;
    centralSize += 46 + nameBytes.length;
  }
  const total = localSize + centralSize + 22;
  if (total > LIMIT) throw new Error('Backup ZIP exceeds the 60 MB limit.');
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let position = 0;
  for (const entry of list) {
    put32(view, position, 0x04034b50);
    put16(view, position + 4, 20);
    put16(view, position + 6, 0x0800);
    put16(view, position + 8, 0);
    put32(view, position + 14, entry.crc);
    put32(view, position + 18, entry.body.length);
    put32(view, position + 22, entry.body.length);
    put16(view, position + 26, entry.nameBytes.length);
    out.set(entry.nameBytes, position + 30);
    out.set(entry.body, position + 30 + entry.nameBytes.length);
    position += 30 + entry.nameBytes.length + entry.body.length;
  }
  const centralOffset = position;
  for (const entry of list) {
    put32(view, position, 0x02014b50);
    put16(view, position + 4, 20);
    put16(view, position + 6, 20);
    put16(view, position + 8, 0x0800);
    put32(view, position + 16, entry.crc);
    put32(view, position + 20, entry.body.length);
    put32(view, position + 24, entry.body.length);
    put16(view, position + 28, entry.nameBytes.length);
    put32(view, position + 42, entry.offset);
    out.set(entry.nameBytes, position + 46);
    position += 46 + entry.nameBytes.length;
  }
  put32(view, position, 0x06054b50);
  put16(view, position + 8, list.length);
  put16(view, position + 10, list.length);
  put32(view, position + 12, position - centralOffset);
  put32(view, position + 16, centralOffset);
  return out;
}

function inspect(bytes: Uint8Array): { name: string; start: number; size: number }[] {
  if (bytes.length > LIMIT) throw new Error('Backup ZIP exceeds 60 MB.');
  if (bytes.length < 22) throw new Error('Invalid ZIP: too short.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (u32(view, p) === 0x06054b50 && p + 22 + u16(view, p + 20) === bytes.length) { eocd = p; break; }
  }
  if (eocd < 0) throw new Error('Invalid ZIP: central directory missing.');
  const count = u16(view, eocd + 10);
  const dirSize = u32(view, eocd + 12);
  const dirStart = u32(view, eocd + 16);
  if (u16(view, eocd + 4) || u16(view, eocd + 6) ||
      count !== u16(view, eocd + 8) || count > ENTRY_LIMIT ||
      count === 65535 || dirStart === 0xffffffff || dirStart + dirSize !== eocd)
    throw new Error('Unsupported ZIP structure.');
  const result: { name: string; start: number; size: number }[] = [];
  const names = new Set<string>();
  let position = dirStart;
  let totalExpanded = 0;
  for (let i = 0; i < count; i++) {
    if (position + 46 > eocd || u32(view, position) !== 0x02014b50) throw new Error('Invalid central directory entry.');
    const flags = u16(view, position + 8);
    const method = u16(view, position + 10);
    const crc = u32(view, position + 16);
    const compressed = u32(view, position + 20);
    const size = u32(view, position + 24);
    const length = u16(view, position + 28);
    const extra = u16(view, position + 30);
    const comment = u16(view, position + 32);
    const localOffset = u32(view, position + 42);
    if (flags !== 0x0800 || method !== 0 || compressed !== size || size === 0xffffffff ||
        localOffset === 0xffffffff || u16(view, position + 34) !== 0)
      throw new Error('Only uncompressed MuseVault ZIP backups are supported.');
    if (position + 46 + length + extra + comment > eocd) throw new Error('Invalid ZIP filename length.');
    const nameBytes = bytes.subarray(position + 46, position + 46 + length);
    const name = decoder.decode(nameBytes);
    if (!allowedPath(name) || names.has(name)) throw new Error('Unexpected or duplicate ZIP path.');
    names.add(name);
    totalExpanded += size;
    if (totalExpanded > LIMIT) throw new Error('Expanded backup exceeds 60 MB.');
    if (localOffset + 30 > dirStart || u32(view, localOffset) !== 0x04034b50)
      throw new Error('Invalid local ZIP header.');
    const localLength = u16(view, localOffset + 26);
    const localExtra = u16(view, localOffset + 28);
    const start = localOffset + 30 + localLength + localExtra;
    if (start + size > dirStart || localLength !== length ||
        u16(view, localOffset + 6) !== flags || u16(view, localOffset + 8) !== method ||
        u32(view, localOffset + 14) !== crc || u32(view, localOffset + 18) !== compressed ||
        u32(view, localOffset + 22) !== size ||
        !nameBytes.every((byte, j) => byte === bytes[localOffset + 30 + j]))
      throw new Error('Local ZIP header mismatch.');
    if (crc32(bytes.subarray(start, start + size)) !== crc) throw new Error('ZIP CRC mismatch.');
    result.push({ name, start, size });
    position += 46 + length + extra + comment;
  }
  if (position !== eocd || count === 0) throw new Error('Invalid ZIP directory.');
  return result;
}
export function checkZipHeaders(bytes: Uint8Array): void { inspect(bytes); }
export function unzipStored(bytes: Uint8Array): Record<string, Uint8Array> {
  const entries: Record<string, Uint8Array> = Object.create(null);
  for (const entry of inspect(bytes)) entries[entry.name] = bytes.slice(entry.start, entry.start + entry.size);
  return entries;
}
