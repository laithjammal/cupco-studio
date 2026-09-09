'use client';

/**
 * Concept gallery.
 *
 * Shows the generated layouts side by side so they can be compared at a
 * glance, which is the whole point — a list of options only helps if the
 * differences are visible without clicking into each one.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CupProfile } from '@cupco/geometry';
import type { ConceptLayout } from '@cupco/concepts';
import {
  conceptsFor, materialiseConcept, renderConceptThumbnail, conceptSwatches,
  prepareConceptTemplates,
  type ConceptSource,
} from '@/lib/concepts-adapter';
import type { Design } from '@/lib/design';

export interface ConceptGalleryProps {
  source: ConceptSource | null;
  profile: CupProfile;
  brandName: string;
  onApply: (design: Design, label: string) => void;
}

const THUMB_W = 300;

function Thumbnail({
  layout, source, selected, onSelect, onApply, ready,
}: {
  layout: ConceptLayout;
  source: ConceptSource;
  selected: boolean;
  onSelect: () => void;
  onApply: () => void;
  /** Bumped when a recoloured template finishes, to redraw the thumbnail. */
  ready: number;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const h = Math.round(THUMB_W * 0.392); // matches the design canvas ratio

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    // Render at 2x for crisp thumbnails on retina displays.
    const canvas = renderConceptThumbnail(layout, source, THUMB_W * 2, h * 2);
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.style.display = 'block';
    el.replaceChildren(canvas);
  }, [layout, source, h, ready]);

  return (
    <div className={`concept${selected ? ' concept--sel' : ''}`}
      onClick={onSelect} onDoubleClick={onApply}>
      <div className="concept__thumb" ref={holder} style={{ height: h }} />
      <div className="concept__body">
        <div className="concept__title">{layout.label}</div>
        <div className="concept__desc">{layout.description}</div>
        <div className="concept__swatches">
          {conceptSwatches(layout, source).map((c) => (
            <i key={c} style={{ background: c }} title={c} />
          ))}
        </div>
      </div>
      <button className="concept__use primary" onClick={(e) => { e.stopPropagation(); onApply(); }}>
        Use this
      </button>
    </div>
  );
}

export default function ConceptGallery({
  source, profile, brandName, onApply,
}: ConceptGalleryProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const concepts = useMemo(
    () => (source ? conceptsFor(source, profile, brandName) : []),
    [source, profile, brandName],
  );

  /**
   * Illustrated templates are recoloured before anything renders.
   *
   * Bumping a counter rather than storing the images: the cache lives in
   * template-art, and this only needs to say "try drawing again now".
   */
  const [ready, setReady] = useState(0);
  useEffect(() => {
    let alive = true;
    prepareConceptTemplates(concepts).then(() => { if (alive) setReady((n) => n + 1); });
    return () => { alive = false; };
  }, [concepts]);

  if (!source) {
    return (
      <div className="concepts__empty">
        <strong>Upload artwork to generate concepts</strong>
        <p>
          Add an SVG logo (or trace a bitmap) and this tab proposes {' '}
          several distinct ways to lay it out on the cup — centred, repeating,
          colour-blocked, oversized and more.
        </p>
        <p className="hint">
          Proposals are rule-based and deterministic: the same logo always gives
          the same set, and every one is fully editable once applied.
        </p>
      </div>
    );
  }

  return (
    <div className="concepts">
      <div className="concepts__bar">
        <strong>{concepts.length} concepts</strong> from {source.name}
        <span className="hint" style={{ marginLeft: 'auto' }}>
          Click to preview · double-click or “Use this” to apply
        </span>
      </div>
      <div className="concepts__grid">
        {concepts.map((c) => (
          <Thumbnail
            key={c.id}
            layout={c}
            source={source}
            selected={selected === c.id}
            onSelect={() => setSelected(c.id)}
            onApply={() => onApply(materialiseConcept(c, source), c.label)}
            ready={ready}
          />
        ))}
      </div>
    </div>
  );
}
