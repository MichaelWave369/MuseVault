import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { getVersionBlob, importArtifact, listArtifacts, normalizeInput } from './store';
import { KINDS, MAX_BACKUP, MAX_FILE, SOURCES } from './types';
import type { Artifact } from './types';

interface Manifest { format: 'musevault-backup'; version: 1; exportedAt: string; artifacts: Artifact[] }
const ENTRY_LIMIT = 800;
const SAFE_ID = /^[a-zA-Z0-9_-]{1,100}$/;

export function checkZipHeaders(bytes: Uint8Array): void {
  if (bytes.length > MAX_BACKUP) throw new Error('Backup ZIP is larger than 60 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (view.getUint32(p, true) === 0x06054b50) { end = p; break; }
  }
  if (end < 0) throw new Error('Invalid ZIP: central directory not found.');
  const count = view.getUint16(end + 10, true);
  const offset = view.getUint32(end + 16, true);
  const size = view.getUint32(end + 12, true);
  if (count > ENTRY_LIMIT || count === 65535 || offset === 0xffffffff || offset + size > end) throw new Error('Unsupported or oversized ZIP backup.');
  let pos = offset;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50) throw new Error('Invalid ZIP entry.');
    const flags = view.getUint16(pos + 8, true);
    const expanded = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    if ((flags & 1) || expanded === 0xffffffff) throw new Error('Encrypted and ZIP64 backups are unsupported.');
    total += expanded;
    if (total > MAX_BACKUP) throw new Error('Uncompressed backup is larger than 60 MB.');
    pos += 46 + nameLength + extraLength + commentLength;
  }
  if (pos !== offset + size) throw new Error('Invalid ZIP central directory size.');
}

export async function exportBackup(): Promise<Blob> {
  const artifacts = await listArtifacts();
  const files: Record<string, Uint8Array> = {};
  let size = 0;
  for (const item of artifacts) {
    for (const version of item.versions) {
      const blob = await getVersionBlob(item.id, version.id);
      if (!blob) throw new Error('Cannot back up a missing file: ' + item.title);
      size += blob.size;
      if (size > MAX_BACKUP) throw new Error('This vault exceeds the 60 MB ZIP export limit. Export large files individually.');
      files['files/' + item.id + '/' + version.id] = new Uint8Array(await blob.arrayBuffer());
    }
  }
  const manifest: Manifest = { format: 'musevault-backup', version: 1, exportedAt: new Date().toISOString(), artifacts };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  if (size + files['manifest.json'].length > MAX_BACKUP) throw new Error('Vault metadata exceeds backup limit.');
  const zip = zipSync(files, { level: 0 });
  return new Blob([Uint8Array.from(zip)], { type: 'application/zip' });
}

function validateArtifact(value: unknown): Artifact {
  if (!value || typeof value !== 'object') throw new Error('Invalid artifact metadata.');
  const item = value as Artifact;
  if (!SAFE_ID.test(item.id) || !Array.isArray(item.versions) || item.versions.length > 200) throw new Error('Invalid artifact ID or version list.');
  if (!KINDS.includes(item.kind) || !SOURCES.includes(item.source)) throw new Error('Unknown artifact type or provenance.');
  if (typeof item.title !== 'string' || typeof item.description !== 'string' || typeof item.collection !== 'string' ||
      !Array.isArray(item.tags) || item.tags.some(t => typeof t !== 'string') ||
      typeof item.createdAt !== 'string' || typeof item.updatedAt !== 'string') throw new Error('Invalid artifact fields.');
  const next = normalizeInput(item);
  if (item.title.length > 140 || item.description.length > 2500 || item.collection.length > 80 || item.tags.length > 16) throw new Error('Artifact metadata exceeds limits.');
  const seen = new Set<string>();
  for (const version of item.versions) {
    if (!version || !SAFE_ID.test(version.id) || seen.has(version.id) ||
        typeof version.filename !== 'string' || version.filename.length > 250 ||
        typeof version.mime !== 'string' || version.mime.length > 150 ||
        typeof version.createdAt !== 'string' ||
        !Number.isSafeInteger(version.size) || version.size < 0 || version.size > MAX_FILE) throw new Error('Invalid artifact version.');
    seen.add(version.id);
  }
  return { ...item, ...next };
}
export async function restoreBackup(file: File): Promise<{ imported: number; skipped: number }> {
  if (file.size > MAX_BACKUP) throw new Error('Backup ZIP is larger than 60 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  checkZipHeaders(bytes);
  const entries = unzipSync(bytes);
  const raw = entries['manifest.json'];
  if (!raw || raw.length > 5 * 1024 * 1024) throw new Error('MuseVault manifest missing or oversized.');
  let manifest: Manifest;
  try { manifest = JSON.parse(strFromU8(raw)) as Manifest; }
  catch { throw new Error('Invalid manifest JSON.'); }
  if (manifest.format !== 'musevault-backup' || manifest.version !== 1 || !Array.isArray(manifest.artifacts) || manifest.artifacts.length > 500) {
    throw new Error('This is not a supported MuseVault backup.');
  }
  const items = manifest.artifacts.map(validateArtifact);
  const seenIds = new Set<string>();
  const contents = new Map<string, Blob>();
  for (const item of items) {
    if (seenIds.has(item.id)) throw new Error('Duplicate artifact ID in backup.');
    seenIds.add(item.id);
    for (const version of item.versions) {
      const key = item.id + '/' + version.id;
      const data = entries['files/' + key];
      if (!data || data.byteLength !== version.size) throw new Error('File missing or size mismatch: ' + item.title);
      contents.set(key, new Blob([Uint8Array.from(data)], { type: version.mime }));
    }
  }
  const expected = 1 + contents.size;
  if (Object.keys(entries).length !== expected) throw new Error('Unexpected entries in backup.');
  let imported = 0, skipped = 0;
  for (const item of items) {
    if (await importArtifact(item, contents)) imported++;
    else skipped++;
  }
  return { imported, skipped };
}
