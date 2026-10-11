export const KINDS = ['document', 'image', 'audio', 'video', 'code', 'research', 'note', 'link', 'other'] as const;
export const SOURCES = ['human', 'ai-assisted', 'imported'] as const;
export type Kind = typeof KINDS[number];
export type Source = typeof SOURCES[number];

export interface Version {
  id: string;
  createdAt: string;
  filename: string;
  mime: string;
  size: number;
}
export interface Artifact {
  id: string;
  title: string;
  description: string;
  kind: Kind;
  collection: string;
  tags: string[];
  source: Source;
  link?: string;
  createdAt: string;
  updatedAt: string;
  versions: Version[];
}
export interface ArtifactInput {
  title: string;
  description: string;
  kind: Kind;
  collection: string;
  tags: string[];
  source: Source;
  link?: string;
}
export const MAX_FILE = 25 * 1024 * 1024;
export const MAX_BACKUP = 60 * 1024 * 1024;

export function detectKind(file: File): Kind {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'css', 'html', 'json', 'yaml', 'yml', 'sh', 'md'].includes(ext)) return 'code';
  if (['pdf', 'doc', 'docx', 'odt', 'txt', 'rtf'].includes(ext)) return 'document';
  return 'other';
}
export function cleanTags(raw: string): string[] {
  return [...new Set(raw.split(',').map(tag => tag.trim().slice(0, 40)).filter(Boolean))].slice(0, 16);
}
export function validUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch { return false; }
}
export function readableBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
