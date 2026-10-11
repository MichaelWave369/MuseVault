import type { Artifact, ArtifactInput, Version } from './types';
import { MAX_FILE, validUrl } from './types';

const NAME = 'musevault-v1';
let connection: Promise<IDBDatabase> | null = null;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Database request failed'));
  });
}
function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Database transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Database transaction aborted'));
  });
}
export function openVault(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('This browser does not support local IndexedDB storage.'));
  if (!connection) {
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('artifacts', { keyPath: 'id' });
        db.createObjectStore('files');
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => req.result.close();
        resolve(req.result);
      };
      req.onerror = () => reject(req.error ?? new Error('Could not open the vault'));
      req.onblocked = () => reject(new Error('Close other MuseVault tabs and refresh to upgrade storage.'));
    }).catch(err => { connection = null; throw err; });
  }
  return connection!;
}
export async function listArtifacts(): Promise<Artifact[]> {
  const db = await openVault();
  const tx = db.transaction('artifacts', 'readonly');
  const result = await request(tx.objectStore('artifacts').getAll() as IDBRequest<Artifact[]>);
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function getArtifact(id: string): Promise<Artifact | undefined> {
  const db = await openVault();
  return request(db.transaction('artifacts', 'readonly').objectStore('artifacts').get(id) as IDBRequest<Artifact | undefined>);
}
export async function getVersionBlob(id: string, versionId: string): Promise<Blob | undefined> {
  const db = await openVault();
  return request(db.transaction('files', 'readonly').objectStore('files').get(id + '/' + versionId) as IDBRequest<Blob | undefined>);
}
export function normalizeInput(input: ArtifactInput): ArtifactInput {
  const title = input.title.trim().slice(0, 140);
  if (!title) throw new Error('An artifact needs a title.');
  if (input.link && !validUrl(input.link)) throw new Error('Links must begin with http:// or https://');
  return {
    ...input, title, description: input.description.trim().slice(0, 2500),
    collection: input.collection.trim().slice(0, 80) || 'Unsorted',
    tags: [...new Set(input.tags.map(t => t.trim().slice(0, 40)).filter(Boolean))].slice(0, 16),
    link: input.link?.trim() || undefined
  };
}
export async function createArtifact(input: ArtifactInput, file?: Blob, filename = 'note.txt'): Promise<Artifact> {
  const data = normalizeInput(input);
  if (file && file.size > MAX_FILE) throw new Error('Files must be 25 MB or smaller.');
  const now = new Date().toISOString();
  const item: Artifact = { ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now, versions: [] };
  if (file) item.versions.push({ id: crypto.randomUUID(), createdAt: now, filename, mime: file.type || 'application/octet-stream', size: file.size });
  const db = await openVault();
  const tx = db.transaction(['artifacts', 'files'], 'readwrite');
  const done = finished(tx);
  tx.objectStore('artifacts').add(item);
  if (file) tx.objectStore('files').put(file, item.id + '/' + item.versions[0].id);
  await done;
  return item;
}
export async function editArtifact(id: string, update: Partial<ArtifactInput>): Promise<void> {
  const item = await getArtifact(id);
  if (!item) throw new Error('Artifact no longer exists.');
  const next = normalizeInput({ title: item.title, description: item.description, kind: item.kind, collection: item.collection, tags: item.tags, source: item.source, link: item.link, ...update });
  const db = await openVault();
  const tx = db.transaction('artifacts', 'readwrite');
  const done = finished(tx);
  tx.objectStore('artifacts').put({ ...item, ...next, updatedAt: new Date().toISOString() });
  await done;
}
export async function addVersion(id: string, file: Blob, filename: string): Promise<void> {
  if (file.size > MAX_FILE) throw new Error('Files must be 25 MB or smaller.');
  const item = await getArtifact(id);
  if (!item) throw new Error('Artifact no longer exists.');
  const now = new Date().toISOString();
  const version: Version = { id: crypto.randomUUID(), filename, mime: file.type || 'application/octet-stream', size: file.size, createdAt: now };
  const db = await openVault();
  const tx = db.transaction(['artifacts', 'files'], 'readwrite');
  const done = finished(tx);
  tx.objectStore('artifacts').put({ ...item, updatedAt: now, versions: [...item.versions, version] });
  tx.objectStore('files').put(file, id + '/' + version.id);
  await done;
}
export async function deleteArtifact(id: string): Promise<void> {
  const item = await getArtifact(id);
  if (!item) return;
  const db = await openVault();
  const tx = db.transaction(['artifacts', 'files'], 'readwrite');
  const done = finished(tx);
  tx.objectStore('artifacts').delete(id);
  for (const version of item.versions) tx.objectStore('files').delete(id + '/' + version.id);
  await done;
}
export async function importArtifact(item: Artifact, contents: Map<string, Blob>): Promise<boolean> {
  const db = await openVault();
  const tx = db.transaction(['artifacts', 'files'], 'readwrite');
  const done = finished(tx);
  const store = tx.objectStore('artifacts');
  const exists = await request(store.get(item.id));
  if (exists) { tx.abort(); await done.catch(() => {}); return false; }
  store.add(item);
  for (const version of item.versions) {
    const key = item.id + '/' + version.id;
    const blob = contents.get(key);
    if (!blob) { tx.abort(); await done.catch(() => {}); throw new Error('Missing file for ' + item.title); }
    tx.objectStore('files').put(blob, key);
  }
  await done;
  return true;
}
