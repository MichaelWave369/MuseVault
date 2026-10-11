import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ChangeEvent, DragEvent } from 'react';
import {
  Archive, ArrowDownToLine, ArrowUpFromLine, BookOpen, Check, ChevronRight, Code2,
  Database, ExternalLink, File, FilePlus2, FileText, FolderClosed, HardDrive,
  Image as ImageIcon, Layers3, LayoutGrid, Link2, List as ListIcon, LockKeyhole,
  Music2, PenLine, Plus, Search, ShieldCheck, Sparkles, Tag, Trash2, UploadCloud,
  Video, X, History, Download, AlertCircle, Inbox, CloudOff
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Artifact, ArtifactInput, Kind, Source, Version } from './types';
import { cleanTags, detectKind, KINDS, MAX_FILE, readableBytes, SOURCES, validUrl } from './types';
import { addVersion, createArtifact, deleteArtifact, editArtifact, getVersionBlob, listArtifacts } from './store';
import { exportBackup, restoreBackup } from './backup';

const ICONS: Record<Kind, LucideIcon> = {
  document: FileText, image: ImageIcon, audio: Music2, video: Video, code: Code2,
  research: BookOpen, note: PenLine, link: Link2, other: File
};
const ACCENTS: Record<Kind, string> = {
  document: 'lavender', image: 'rose', audio: 'amber', video: 'teal', code: 'sky',
  research: 'lavender', note: 'amber', link: 'teal', other: 'slate'
};
type Mode = 'file' | 'note' | 'link';
type Draft = ArtifactInput & { mode: Mode; tagsText: string; noteText: string };
const newDraft = (mode: Mode = 'file'): Draft => ({
  mode, title: '', description: '', kind: mode === 'file' ? 'document' : mode,
  collection: 'Unsorted', tags: [], tagsText: '', source: 'human', link: '', noteText: ''
});
function formatDate(date: string) {
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? 'Unknown date' : value.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 20000);
}
function byVersion(item: Artifact, versionId: string): Version | undefined {
  return item.versions.find(v => v.id === versionId) || item.versions[item.versions.length - 1];
}

export default function App() {
  const [items, setItems] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [collection, setCollection] = useState('All artifacts');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [showModal, setShowModal] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<Draft>(newDraft());
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewText, setPreviewText] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const revisionInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => setItems(await listArtifacts()), []);
  useEffect(() => {
    refresh().catch(err => setFatal(errorMessage(err))).finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 6000);
    return () => window.clearTimeout(timer);
  }, [message]);
  const selected = items.find(item => item.id === selectedId) || null;
  const selectedVersion = selected ? byVersion(selected, versionId) : undefined;
  useEffect(() => {
    let cancelled = false;
    let url = '';
    setPreviewUrl('');
    setPreviewText('');
    if (selected && selectedVersion) {
      getVersionBlob(selected.id, selectedVersion.id).then(async blob => {
        if (!blob || cancelled) return;
        url = URL.createObjectURL(blob);
        if (cancelled) { URL.revokeObjectURL(url); return; }
        setPreviewUrl(url);
        const mime = selectedVersion.mime.toLowerCase();
        const extension = selectedVersion.filename.split('.').pop()?.toLowerCase();
        const isText = mime.startsWith('text/') || ['md', 'txt', 'json', 'ts', 'tsx', 'js', 'css', 'html', 'py', 'yaml', 'yml', 'csv', 'svg'].includes(extension || '');
        if (isText && blob.size <= 300000) {
          const text = await blob.text();
          if (!cancelled) setPreviewText(text.slice(0, 50000));
        }
      }).catch(err => { if (!cancelled) setMessage(errorMessage(err)); });
    }
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [selected?.id, selectedVersion?.id]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { setShowModal(false); setSelectedId(null); }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);
  const collections = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach(item => counts.set(item.collection, (counts.get(item.collection) || 0) + 1));
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);
  const filtered = useMemo(() => items.filter(item => {
    if (collection !== 'All artifacts' && item.collection !== collection) return false;
    if (kind !== 'all' && item.kind !== kind) return false;
    const haystack = [item.title, item.description, item.collection, item.source, ...item.tags].join(' ').toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [items, collection, kind, query]);
  const totalSize = items.reduce((sum, item) => sum + item.versions.reduce((s, v) => s + v.size, 0), 0);
  const revisions = items.reduce((sum, item) => sum + Math.max(0, item.versions.length - 1), 0);

  function openCreate(mode: Mode = 'file') {
    setSelectedId(null);
    setEditMode(false);
    setPickedFile(null);
    setDraft(newDraft(mode));
    setShowModal(true);
  }
  function openEdit() {
    if (!selected) return;
    setEditMode(true);
    setDraft({
      ...selected, mode: selected.kind === 'link' ? 'link' : selected.kind === 'note' ? 'note' : 'file',
      tagsText: selected.tags.join(', '), noteText: ''
    });
    setPickedFile(null);
    setShowModal(true);
  }
  async function onQuickFiles(files: FileList | File[]) {
    const incoming = Array.from(files);
    if (!incoming.length) return;
    setBusy(true);
    let added = 0;
    try {
      for (const file of incoming) {
        if (file.size > MAX_FILE) throw new Error(file.name + ' exceeds 25 MB. Added ' + added + ' earlier files.');
        await createArtifact({
          title: file.name.replace(/\.[^.]+$/, '').slice(0, 140) || file.name,
          description: '', kind: detectKind(file), collection: 'Unsorted',
          tags: [], source: 'imported'
        }, file, file.name);
        added++;
      }
      setMessage(added + ' artifact' + (added === 1 ? '' : 's') + ' safely stored on this device.');
    } catch (err) { setMessage(errorMessage(err)); }
    finally {
      await refresh().catch(err => setFatal(errorMessage(err)));
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }
  async function submitDraft(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const input: ArtifactInput = {
        title: draft.title, description: draft.description, kind: draft.kind,
        collection: draft.collection, tags: cleanTags(draft.tagsText),
        source: draft.source, link: draft.mode === 'link' || editMode ? draft.link : undefined
      };
      if (editMode) {
        if (!selected) throw new Error('Select an artifact first.');
        await editArtifact(selected.id, input);
        setMessage('Artifact details updated.');
      } else if (draft.mode === 'file') {
        if (!pickedFile) throw new Error('Choose a file for this artifact.');
        await createArtifact(input, pickedFile, pickedFile.name);
        setMessage('Artifact added to your vault.');
      } else if (draft.mode === 'note') {
        await createArtifact({ ...input, kind: 'note' }, new Blob([draft.noteText], { type: 'text/plain' }), 'note.txt');
        setMessage('Note safely stored.');
      } else {
        if (!draft.link || !validUrl(draft.link)) throw new Error('Enter a valid HTTP(S) link.');
        await createArtifact({ ...input, kind: 'link', link: draft.link });
        setMessage('Link saved.');
      }
      await refresh();
      setShowModal(false);
    } catch (err) { setMessage(errorMessage(err)); }
    finally { setBusy(false); }
  }
  async function onRevision(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !selected) return;
    setBusy(true);
    try {
      await addVersion(selected.id, file, file.name);
      await refresh();
      setVersionId('');
      setMessage('A new immutable file version was added.');
    } catch (err) { setMessage(errorMessage(err)); }
    finally { setBusy(false); event.target.value = ''; }
  }
  async function onDelete() {
    if (!selected || busy) return;
    if (!window.confirm('Permanently delete "' + selected.title + '" and all its versions from this browser? Export a backup first if needed.')) return;
    setBusy(true);
    try {
      await deleteArtifact(selected.id);
      setSelectedId(null);
      await refresh();
      setMessage('Artifact removed from this device.');
    } catch (err) { setMessage(errorMessage(err)); }
    finally { setBusy(false); }
  }
  async function onExport() {
    setBusy(true);
    try {
      const blob = await exportBackup();
      downloadBlob(blob, 'musevault-' + new Date().toISOString().slice(0, 10) + '.zip');
      setMessage('Backup exported. Keep the ZIP in a safe place.');
    } catch (err) { setMessage(errorMessage(err)); }
    finally { setBusy(false); }
  }
  async function onRestore(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const result = await restoreBackup(file);
      await refresh();
      setMessage('Restored ' + result.imported + ' artifacts; skipped ' + result.skipped + ' already on this device.');
    } catch (err) {
      await refresh().catch(() => {});
      setMessage('Restore failed: ' + errorMessage(err));
    } finally { setBusy(false); event.target.value = ''; }
  }
  async function onDownload() {
    if (!selected || !selectedVersion) return;
    try {
      const blob = await getVersionBlob(selected.id, selectedVersion.id);
      if (!blob) throw new Error('This version could not be found.');
      downloadBlob(blob, selectedVersion.filename);
    } catch (err) { setMessage(errorMessage(err)); }
  }
  function chooseItem(item: Artifact) { setSelectedId(item.id); setVersionId(''); }

  return (
    <div className="app">
      <input ref={fileInput} type="file" multiple hidden onChange={e => { if (e.target.files) void onQuickFiles(e.target.files); }} aria-label="Choose files to import" />
      <input ref={restoreInput} type="file" accept=".zip,application/zip" hidden onChange={e => void onRestore(e)} aria-label="Choose a MuseVault ZIP backup" />
      <input ref={revisionInput} type="file" hidden onChange={e => void onRevision(e)} aria-label="Choose a new version" />
      <aside className="sidebar">
        <a className="brand" href="./" aria-label="MuseVault home">
          <span className="brand-mark"><Layers3 size={23} strokeWidth={2.2} /></span>
          <span><strong>MuseVault</strong><small>THE CREATIVE ARCHIVE</small></span>
        </a>
        <div className="sidebar-divider" />
        <div className="nav-caption">WORKSPACE</div>
        <button className={'nav-link ' + (collection === 'All artifacts' ? 'active' : '')} onClick={() => { setCollection('All artifacts'); setKind('all'); }}>
          <LayoutGrid size={18} /> All artifacts <span className="nav-count">{items.length}</span>
        </button>
        <button className="nav-link" onClick={() => openCreate('note')}><PenLine size={18} /> New note <Plus size={15} className="right-icon" /></button>
        <button className="nav-link" onClick={() => openCreate('link')}><Link2 size={18} /> Save a link <Plus size={15} className="right-icon" /></button>
        <div className="nav-caption spaced">COLLECTIONS</div>
        {collections.length === 0 && <p className="sidebar-hint">Collections appear as you save artifacts.</p>}
        {collections.map(([name, count]) => (
          <button key={name} className={'nav-link ' + (collection === name ? 'active' : '')} onClick={() => { setCollection(name); setKind('all'); }}>
            <FolderClosed size={17} /> <span className="ellipsis">{name}</span> <span className="nav-count">{count}</span>
          </button>
        ))}
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <span className="privacy-icon"><LockKeyhole size={17} /></span>
            <strong>Yours. Really yours.</strong>
            <p>Files stay in this browser. No account, no cloud uploads, no tracking.</p>
            <span className="privacy-status"><span /> Local-first storage</span>
          </div>
          <p className="sidebar-version">MuseVault v0.1 • Crafted for curious minds</p>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><ChevronRight size={15} /><strong>{collection}</strong></div>
          <div className="top-actions">
            <span className="storage-pill"><HardDrive size={14} /> {readableBytes(totalSize)} stored</span>
            <button className="icon-btn mobile-hide" title="Restore backup" aria-label="Restore ZIP backup" onClick={() => restoreInput.current?.click()} disabled={busy}><ArrowUpFromLine size={17} /></button>
            <button className="btn btn-subtle mobile-hide" onClick={() => void onExport()} disabled={busy}><ArrowDownToLine size={16} /> Backup</button>
            <button className="btn btn-primary" onClick={() => openCreate()} disabled={busy}><Plus size={17} /> Add artifact</button>
          </div>
        </header>

        <div className="page">
          <section className="hero">
            <div className="hero-art" aria-hidden="true"><span className="orb orb-1" /><span className="orb orb-2" /><span className="orb orb-3" /><span className="hero-grid" /></div>
            <div className="hero-content">
              <span className="eyebrow"><Sparkles size={14} /> YOUR CREATIVE UNIVERSE</span>
              <h1>A home for every <em>spark.</em></h1>
              <p>Gather your ideas, preserve their evolution, and rediscover what connects them. Every creation has a story worth keeping.</p>
              <div className="hero-actions">
                <button className="btn btn-white" onClick={() => openCreate()}><Plus size={18} /> Create an artifact</button>
                <button className="hero-link" onClick={() => fileInput.current?.click()} disabled={busy}><UploadCloud size={17} /> Import files <ChevronRight size={14} /></button>
              </div>
            </div>
          </section>

          <div className="stats">
            <div className="stat"><span className="stat-icon purple"><Archive size={19} /></span><div><strong>{items.length}</strong><span>Total artifacts</span></div></div>
            <div className="stat"><span className="stat-icon aqua"><FolderClosed size={19} /></span><div><strong>{collections.length}</strong><span>Collections</span></div></div>
            <div className="stat"><span className="stat-icon peach"><History size={19} /></span><div><strong>{revisions}</strong><span>Saved revisions</span></div></div>
            <div className="stat"><span className="stat-icon blue"><ShieldCheck size={19} /></span><div><strong>Private</strong><span>Device-based vault</span></div></div>
          </div>

          {fatal ? <div className="alert"><AlertCircle size={19} /><span>{fatal} Try a supported browser with storage enabled.</span></div> : null}
          {message && <div className="toast" role="status"><Check size={17} /> {message}<button onClick={() => setMessage('')} aria-label="Dismiss notification"><X size={15} /></button></div>}
          <section className="library-section">
            <div className="section-heading">
              <div><span className="small-label">YOUR LIBRARY</span><h2>{collection === 'All artifacts' ? 'Explore your artifacts' : collection}</h2><p>Organize your thoughts. Find your next connection.</p></div>
              <button className="btn btn-outline section-add" onClick={() => fileInput.current?.click()} disabled={busy}><UploadCloud size={16} /> Quick upload</button>
            </div>

            <div className="filters">
              <label className="search-box"><Search size={19} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search titles, descriptions, tags..." aria-label="Search artifacts" /></label>
              <label className="kind-select"><span className="sr-only">Filter by kind</span><select value={kind} onChange={e => setKind(e.target.value as Kind | 'all')}><option value="all">All types</option>{KINDS.map(k => <option value={k} key={k}>{capitalize(k)}</option>)}</select></label>
              <div className="layout-switch" aria-label="View layout"><button aria-label="Grid view" aria-pressed={layout === 'grid'} className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')}><LayoutGrid size={18} /></button><button aria-label="List view" aria-pressed={layout === 'list'} className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')}><ListIcon size={18} /></button></div>
            </div>
            <div className="result-line"><span>{loading ? 'Loading library...' : filtered.length + ' artifact' + (filtered.length === 1 ? '' : 's')}</span><span>Latest updates first</span></div>

            {!loading && !fatal && items.length === 0 ? (
              <div className={'empty-vault ' + (dragging ? 'dragging' : '')} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={e => { e.preventDefault(); setDragging(false); }} onDrop={e => { e.preventDefault(); setDragging(false); void onQuickFiles(e.dataTransfer.files); }}>
                <div className="empty-graphic"><span><Inbox size={38} strokeWidth={1.4} /></span></div>
                <h3>Your story starts here.</h3><p>Drop files here, capture a thought, or save a link. This space is yours to fill, one idea at a time.</p>
                <div className="empty-actions"><button className="btn btn-primary" onClick={() => fileInput.current?.click()} disabled={busy}><UploadCloud size={17} /> Upload files</button><button className="btn btn-outline" onClick={() => openCreate('note')}><PenLine size={17} /> Write a note</button></div>
                <span className="empty-foot"><CloudOff size={15} /> Stored privately on this device • Up to 25 MB per file</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="no-results"><Search size={30} /><h3>Nothing matched your search.</h3><p>Try another search or change the filter.</p><button className="btn btn-outline" onClick={() => { setQuery(''); setKind('all'); setCollection('All artifacts'); }}>Clear filters</button></div>
            ) : (
              <div className={'artifact-layout ' + (layout === 'list' ? 'list-layout' : '')}>
                {filtered.map(item => {
                  const Icon = ICONS[item.kind];
                  const latest = item.versions[item.versions.length - 1];
                  return <button key={item.id} className="artifact-card" onClick={() => chooseItem(item)} aria-label={'Open ' + item.title}>
                    <span className={'artifact-art ' + ACCENTS[item.kind]}><Icon size={30} strokeWidth={1.5} /><span className="art-type">{item.kind}</span></span>
                    <span className="artifact-info"><span className="artifact-title">{item.title}</span><span className="artifact-description">{item.description || (item.kind === 'link' ? item.link : latest?.filename) || 'No description yet'}</span><span className="artifact-meta"><span>{item.collection}</span><span className="dot-sep">•</span><span>{formatDate(item.updatedAt)}</span></span></span>
                    <span className="artifact-arrow"><ChevronRight size={17} /></span>
                  </button>;
                })}
              </div>
            )}
          </section>
          <footer className="footer"><span><Layers3 size={15} /> MuseVault • A little more room for big ideas.</span><span>Local-first by design. Export backups regularly.</span></footer>
        </div>
      </main>

      {selected && <div className="drawer-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSelectedId(null); }}>
        <aside className="drawer" role="dialog" aria-modal="true" aria-label={'Artifact ' + selected.title}>
          <header className="drawer-header"><span><Database size={16} /> ARTIFACT DETAILS</span><button className="icon-btn" onClick={() => setSelectedId(null)} aria-label="Close details"><X size={20} /></button></header>
          <div className="drawer-scroll">
            <div className={'detail-art ' + ACCENTS[selected.kind]}>{(() => { const Icon = ICONS[selected.kind]; return <Icon size={48} strokeWidth={1.25} />; })()}</div>
            <span className="detail-type">{selected.kind} · {selected.source}</span>
            <h2 className="detail-title">{selected.title}</h2>
            <p className="detail-description">{selected.description || 'No description added yet.'}</p>
            <div className="detail-actions"><button className="btn btn-primary" onClick={openEdit}><PenLine size={16} /> Edit details</button><button className="btn btn-outline" onClick={() => void onDownload()} disabled={!selectedVersion}><Download size={16} /> Download</button></div>
            {selected.kind === 'link' && selected.link && validUrl(selected.link) && <a className="link-out" href={selected.link} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> Open saved link</a>}
            <div className="detail-divider" />
            <div className="detail-facts"><div><span>Collection</span><strong><FolderClosed size={15} /> {selected.collection}</strong></div><div><span>Created</span><strong>{formatDate(selected.createdAt)}</strong></div><div><span>Updated</span><strong>{formatDate(selected.updatedAt)}</strong></div><div><span>Versions</span><strong>{selected.versions.length}</strong></div></div>
            <div className="detail-tags"><strong><Tag size={15} /> Tags</strong><div>{selected.tags.length ? selected.tags.map(t => <span key={t}>{t}</span>) : <small>No tags added.</small>}</div></div>
            {selected.versions.length > 0 && <>
              <div className="detail-divider" />
              <div className="detail-section-title"><h3>Version history</h3><button onClick={() => revisionInput.current?.click()} className="text-action" disabled={busy}><Plus size={15} /> Add version</button></div>
              <div className="version-list">{[...selected.versions].reverse().map((v, i) => <button key={v.id} onClick={() => setVersionId(v.id)} className={'version-item ' + (selectedVersion?.id === v.id ? 'selected' : '')}><span className="version-dot" /><span><strong>{i === 0 ? 'Latest version' : 'Previous version'}</strong><small>{v.filename} · {readableBytes(v.size)} · {formatDate(v.createdAt)}</small></span>{selectedVersion?.id === v.id && <Check size={15} />}</button>)}</div>
              <h3 className="preview-title">Preview</h3>
              <div className="preview-pane">
                {!previewUrl ? <span>Loading preview...</span>
                : selectedVersion?.mime.startsWith('image/') ? <img src={previewUrl} alt={selected.title} />
                : selectedVersion?.mime.startsWith('audio/') ? <audio controls src={previewUrl} />
                : selectedVersion?.mime.startsWith('video/') ? <video controls src={previewUrl} />
                : selectedVersion?.mime === 'application/pdf' ? <iframe src={previewUrl} title={'Preview ' + selected.title} sandbox="" />
                : previewText ? <pre>{previewText}</pre>
                : <div><File size={27} /><p>Preview unavailable for this file type.</p><button className="btn btn-outline" onClick={() => void onDownload()}>Download file</button></div>}
              </div>
            </>}
            <div className="detail-divider" />
            <button className="danger-button" onClick={() => void onDelete()} disabled={busy}><Trash2 size={16} /> Delete artifact and versions</button>
          </div>
        </aside>
      </div>}

      {showModal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setShowModal(false); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-label={editMode ? 'Edit artifact' : 'Create artifact'}>
          <div className="modal-header"><span className="modal-symbol"><FilePlus2 size={23} /></span><div><h2>{editMode ? 'Edit artifact' : 'Add to your universe'}</h2><p>{editMode ? 'Update organization and metadata.' : 'One little idea can lead to something extraordinary.'}</p></div><button className="icon-btn" onClick={() => setShowModal(false)} disabled={busy} aria-label="Close"><X size={20} /></button></div>
          {!editMode && <div className="mode-tabs">{([['file', UploadCloud, 'Upload file'], ['note', PenLine, 'Write note'], ['link', Link2, 'Save link']] as const).map(([mode, Icon, label]) => <button type="button" key={mode} className={draft.mode === mode ? 'active' : ''} onClick={() => { setDraft(newDraft(mode)); setPickedFile(null); }}><Icon size={17} />{label}</button>)}</div>}
          <form onSubmit={e => void submitDraft(e)} className="artifact-form">
            {!editMode && draft.mode === 'file' && <label className="file-picker"><UploadCloud size={24} /><span>{pickedFile ? pickedFile.name : 'Choose an artifact from your device'}</span><small>{pickedFile ? readableBytes(pickedFile.size) : 'Up to 25 MB, any file format'}</small><input type="file" onChange={e => { const file = e.target.files?.[0] || null; setPickedFile(file); if (file) setDraft(d => ({ ...d, title: d.title || file.name.replace(/\.[^.]+$/, ''), kind: detectKind(file) })); }} required /></label>}
            {!editMode && draft.mode === 'link' && <label className="field"><span>URL <b>*</b></span><input type="url" placeholder="https://example.com/your-inspiration" value={draft.link || ''} onChange={e => setDraft(d => ({ ...d, link: e.target.value }))} required /></label>}
            <label className="field"><span>Title <b>*</b></span><input required maxLength={140} placeholder="Give this creation a name..." value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} /></label>
            {!editMode && draft.mode === 'note' && <label className="field"><span>Your note</span><textarea rows={5} placeholder="Capture the thought before it gets away..." value={draft.noteText} onChange={e => setDraft(d => ({ ...d, noteText: e.target.value }))} /></label>}
            <label className="field"><span>Description</span><textarea rows={2} maxLength={2500} placeholder="What's the story behind it?" value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} /></label>
            <div className="form-row">
              <label className="field"><span>Collection</span><input maxLength={80} list="known-collections" value={draft.collection} onChange={e => setDraft(d => ({ ...d, collection: e.target.value }))} /><datalist id="known-collections">{collections.map(([name]) => <option value={name} key={name} />)}</datalist></label>
              <label className="field"><span>Source</span><select value={draft.source} onChange={e => setDraft(d => ({ ...d, source: e.target.value as Source }))}>{SOURCES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}</select></label>
            </div>
            <div className="form-row">
              <label className="field"><span>Kind</span><select disabled={!editMode && draft.mode !== 'file'} value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value as Kind }))}>{KINDS.map(k => <option key={k} value={k}>{capitalize(k)}</option>)}</select></label>
              <label className="field"><span>Tags <small>(comma-separated)</small></span><input placeholder="art, ideas, research" value={draft.tagsText} onChange={e => setDraft(d => ({ ...d, tagsText: e.target.value }))} /></label>
            </div>
            <div className="modal-footer"><span><LockKeyhole size={14} /> Saved locally, never uploaded.</span><div><button type="button" className="btn btn-outline" disabled={busy} onClick={() => setShowModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : editMode ? 'Save changes' : 'Save artifact'} <Check size={16} /></button></div></div>
          </form>
        </section>
      </div>}
      <div className="mobile-backup"><button onClick={() => restoreInput.current?.click()}><ArrowUpFromLine size={15} /> Restore</button><button onClick={() => void onExport()}><ArrowDownToLine size={15} /> Backup</button></div>
    </div>
  );
}
function errorMessage(err: unknown): string {
  if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'UnknownError')) return 'Browser storage is full or unavailable. Export a backup and free some space.';
  return err instanceof Error ? err.message : 'An unexpected error occurred.';
}
function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1).replace('-', ' '); }
