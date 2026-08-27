'use client';

/**
 * A collapsible sidebar section.
 *
 * The sidebar had grown to twenty stacked blocks in a 320px column, mixing
 * project management, cup configuration, element editing and export. Grouping
 * them is not decoration: at that length the control you want is always
 * off-screen, and scrolling past nineteen things to reach it is the actual
 * cost.
 *
 * The `summary` is what makes a COLLAPSED section still useful - "8oz Single
 * Wall", "3 layers", "Vector CMYK ready". A closed section that says nothing
 * has to be opened to be checked, which defeats the point of closing it.
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export default function Section({
  title,
  summary,
  defaultOpen = false,
  /** When set, the section opens itself whenever this value changes. */
  openOn,
  tone,
  children,
}: {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  openOn?: string | number | null;
  tone?: 'ok' | 'warn' | 'err';
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Selecting an element should reveal its properties without a second click.
  useEffect(() => {
    if (openOn !== undefined && openOn !== null) setOpen(true);
  }, [openOn]);

  return (
    <section className="sect" data-open={open}>
      <button className="sect__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="sect__chev" aria-hidden>▸</span>
        <span className="sect__title">{title}</span>
        {summary !== undefined && (
          <span className="sect__summary" data-tone={tone}>{summary}</span>
        )}
      </button>
      {open && <div className="sect__body">{children}</div>}
    </section>
  );
}
