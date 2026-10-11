import { checkZipHeaders, unzipStored, zipStored } from './zip';
import { getVersionBlob, importArtifact, listArtifacts, normalizeInput } from './store';
import { KINDS, MAX_BACKUP, MAX_FILE, SOURCES } from './types';
import type { Artifact } from './types';

interface Manifest { format: 'musevault-backup'; version: 1; exportedAt: string; artifacts: Artifact[] }
const SAFE_ID = /^[a-zA-Z0-9_-]{1,100}$/;

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
  files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  if (size + files['manifest.json'].length > MAX_BACKUP) throw new Error('Vault metadata exceeds backup limit.');
  const zip = zipStored(files);
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
  const entries = unzipStored(bytes);
  const raw = entries['manifest.json'];
  if (!raw || raw.length > 5 * 1024 * 1024) throw new Error('MuseVault manifest missing or oversized.');
  let manifest: Manifest;
  try { manifest = JSON.parse(new TextDecoder().decode(raw)) as Manifest; }
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
