import { describe, expect, it } from 'vitest';
import { checkZipHeaders } from '../src/backup';
import { cleanTags, detectKind, validUrl } from '../src/types';
import { zipSync, strToU8 } from 'fflate';

describe('artifact metadata', () => {
  it('deduplicates and trims tags', () => expect(cleanTags('art, art, research, , art')).toEqual(['art', 'research']));
  it('accepts only HTTP(S) links', () => {
    expect(validUrl('https://example.com/note')).toBe(true);
    expect(validUrl('javascript:alert(1)')).toBe(false);
    expect(validUrl('file:///private')).toBe(false);
  });
  it('recognizes code extensions', () => {
    expect(detectKind({ name: 'main.tsx', type: '' } as File)).toBe('code');
  });
});
describe('backup safety', () => {
  it('accepts a small normal ZIP', () => {
    const archive = zipSync({ 'manifest.json': strToU8('{}') });
    expect(() => checkZipHeaders(archive)).not.toThrow();
  });
  it('rejects corrupt bytes', () => expect(() => checkZipHeaders(new Uint8Array([1, 2, 3]))).toThrow());
  it('rejects oversized claimed uncompressed ZIP data', () => {
    const archive = zipSync({ 'manifest.json': strToU8('{}') });
    const copy = Uint8Array.from(archive);
    const pos = copy.findIndex((_x, i) => i + 4 < copy.length && copy[i] === 0x50 && copy[i + 1] === 0x4b && copy[i + 2] === 0x01 && copy[i + 3] === 0x02);
    const view = new DataView(copy.buffer);
    view.setUint32(pos + 24, 70 * 1024 * 1024, true);
    expect(() => checkZipHeaders(copy)).toThrow(/larger/);
  });
});
