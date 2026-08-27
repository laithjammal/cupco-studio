'use client';

/**
 * Projects and version snapshots.
 *
 * Deliberately quiet: saving is automatic, so the common case shows nothing
 * but the project name and a small state line. The destructive operations are
 * behind a confirmation, and the version list is collapsed until asked for.
 */

import { useEffect, useRef, useState } from 'react';
import type { ProjectsApi } from '@/lib/useProjects';

function savedLabel(api: ProjectsApi): string {
  if (api.saveState === 'saving') return 'Saving…';
  if (api.saveState === 'error') return 'Not saved';
  if (api.saveState === 'idle') return 'Unsaved changes';
  if (!api.lastSavedAt) return 'Saved';
  const seconds = Math.round((Date.now() - api.lastSavedAt) / 1000);
  if (seconds < 5) return 'Saved just now';
  if (seconds < 60) return `Saved ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Saved ${minutes}m ago`;
  return `Saved ${new Date(api.lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

const when = (t: number) =>
  new Date(t).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

export default function ProjectBar({ api }: { api: ProjectsApi }) {
  const [showProjects, setShowProjects] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [name, setName] = useState(api.currentName);
  const [label, setLabel] = useState('');
  const [, tick] = useState(0);
  const editing = useRef(false);

  // Follow the store unless the operator is mid-edit in the name field.
  useEffect(() => { if (!editing.current) setName(api.currentName); }, [api.currentName]);

  // "Saved 20s ago" is only true for a second. Re-render slowly so it stays
  // honest without the cost of a per-second timer.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const commitName = () => {
    editing.current = false;
    if (api.currentId && name.trim() !== api.currentName) {
      void api.renameProject(api.currentId, name);
    }
  };

  // Deleting is permanent - there is no trash to recover from - and it takes
  // the project's saved versions with it, which the operator has to be told.
  const confirmDelete = (id: string, projectName: string) => {
    if (window.confirm(
      `Delete "${projectName}" permanently?\n\nIts saved versions go too. This cannot be undone.`,
    )) {
      void api.deleteProject(id);
    }
  };

  const stateColor = api.saveState === 'error' ? 'var(--err)'
    : api.saveState === 'saved' ? 'var(--muted)' : 'var(--warn)';

  return (
    <div className="projects">
      <div className="field" style={{ marginBottom: 8 }}>
        <label htmlFor="pname">Project</label>
        <input
          id="pname" type="text" value={name}
          disabled={!api.ready}
          onFocus={() => { editing.current = true; }}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
        <div className="projects__state" style={{ color: stateColor }}>
          {api.ready ? savedLabel(api) : 'Loading saved work…'}
          {api.storageInfo && api.storageInfo.quotaMb > 0 && (
            <span className="projects__quota">
              {api.storageInfo.usedMb < 1
                ? '· under 1MB used'
                : `· ${api.storageInfo.usedMb.toFixed(0)}MB used`}
            </span>
          )}
        </div>
        {api.saveError && <div className="note note--err" style={{ marginTop: 8 }}>{api.saveError}</div>}
      </div>

      <div className="btnrow" style={{ marginBottom: 10 }}>
        <button onClick={() => void api.newProject()} disabled={!api.ready}>+ New</button>
        <button onClick={() => setShowProjects((v) => !v)} disabled={!api.ready}>
          {showProjects ? 'Hide' : 'All'} ({api.projects.length})
        </button>
        <button onClick={() => setShowVersions((v) => !v)} disabled={!api.ready}>
          Versions ({api.versions.length})
        </button>
      </div>

      {showProjects && (
        <ul className="layers" style={{ marginBottom: 12 }}>
          {api.projects.length === 0 && <li className="layers__empty">No saved projects</li>}
          {api.projects.map((p) => (
            <li key={p.id} data-sel={p.id === api.currentId}
              onClick={() => void api.openProject(p.id)}>
              {p.thumbnail
                ? <img className="projects__thumb" src={p.thumbnail} alt="" />
                : <span className="projects__thumb projects__thumb--none" />}
              <span className="layers__name">
                {p.name}
                <span className="projects__meta">
                  {p.elementCount} element{p.elementCount === 1 ? '' : 's'} · {when(p.updatedAt)}
                </span>
              </span>
              <span className="layers__ops">
                <button title="Duplicate"
                  onClick={(e) => { e.stopPropagation(); void api.duplicateProject(p.id); }}>⧉</button>
                <button title="Delete"
                  onClick={(e) => { e.stopPropagation(); confirmDelete(p.id, p.name); }}>✕</button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {showVersions && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="vlabel">Save this version</label>
            <div className="field row">
              <input id="vlabel" type="text" value={label} placeholder="e.g. Sent to customer"
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { void api.saveVersion(label); setLabel(''); }
                }} />
              <button className="primary"
                onClick={() => { void api.saveVersion(label); setLabel(''); }}>Save</button>
            </div>
            <div className="hint">
              A version is a permanent copy. Editing afterwards never changes it,
              so it stays a true record of what was shown or approved.
            </div>
          </div>

          <ul className="layers">
            {api.versions.length === 0 && <li className="layers__empty">No versions yet</li>}
            {api.versions.map((v) => (
              <li key={v.id}>
                {v.thumbnail
                  ? <img className="projects__thumb" src={v.thumbnail} alt="" />
                  : <span className="projects__thumb projects__thumb--none" />}
                <span className="layers__name">
                  {v.ordinal}. {v.label}
                  <span className="projects__meta">{when(v.createdAt)}</span>
                </span>
                <span className="layers__ops">
                  <button title="Restore into the editor"
                    onClick={() => void api.restoreVersion(v.id)}>↺</button>
                  <button title="Delete this version"
                    onClick={() => {
                      if (window.confirm(`Delete version "${v.label}" permanently?`)) {
                        void api.deleteVersion(v.id);
                      }
                    }}>✕</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
