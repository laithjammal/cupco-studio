'use client';

/**
 * The preflight report.
 *
 * Ordered most severe first and always visible - a check the operator has to
 * remember to run is a check that gets skipped on the busy day when it would
 * have mattered.
 *
 * Clicking an issue selects the element it is about, because the useful
 * response to "this logo is 3mm into the rim curl" is to look at that logo.
 */

import { useState } from 'react';
import type { PreflightIssue, PreflightReport, Severity } from '@cupco/preflight';

const TONE: Record<Severity, string> = {
  error: 'note--err',
  warning: 'note--warn',
  info: 'note--ok',
};

const MARK: Record<Severity, string> = { error: '✕', warning: '!', info: 'i' };

export default function PreflightPanel({
  report,
  onSelect,
}: {
  report: PreflightReport;
  onSelect?: (elementId: string) => void;
}) {
  const [open, setOpen] = useState(true);

  const headline = report.errors > 0
    ? `${report.errors} ${report.errors === 1 ? 'problem blocks' : 'problems block'} export`
    : report.warnings > 0
      ? `${report.warnings} ${report.warnings === 1 ? 'warning' : 'warnings'}`
      : 'Ready to print';

  const tone = report.errors > 0 ? 'note--err'
    : report.warnings > 0 ? 'note--warn' : 'note--ok';

  const clean = report.issues.length === 0;

  return (
    <div className={`field${clean ? ' preflight--clean' : ''}`}>
      <label>Preflight</label>

      {/* Nothing to toggle when there is nothing to show, so a clean report is a
          plain banner. Rendering it as a disabled button would grey out the one
          state that should look confident. */}
      {clean ? (
        <div className={`preflight__head note ${tone}`}>
          <strong>{headline}</strong>
          <span className="preflight__counts">Nothing to fix</span>
        </div>
      ) : (
        <button
          className={`preflight__head note ${tone}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title="Show or hide the details"
        >
          <strong>{headline}</strong>
          <span className="preflight__counts">
            {[
              report.errors && `${report.errors} blocking`,
              report.warnings && `${report.warnings} to check`,
              report.infos && `${report.infos} note${report.infos === 1 ? '' : 's'}`,
            ].filter(Boolean).join(' · ')}
          </span>
        </button>
      )}

      {open && report.issues.length > 0 && (
        <ul className="preflight">
          {report.issues.map((issue, i) => (
            <Row key={`${issue.rule}-${issue.elementId ?? i}-${i}`} issue={issue} onSelect={onSelect} />
          ))}
        </ul>
      )}

      {/* When there is nothing to fix, the banner already says so. Repeating it
          as a paragraph is noise the operator learns to scroll past - and then
          scrolls past the version that DOES list problems. */}
    </div>
  );
}

function Row({
  issue,
  onSelect,
}: {
  issue: PreflightIssue;
  onSelect?: (elementId: string) => void;
}) {
  const clickable = Boolean(issue.elementId && onSelect);
  return (
    <li
      className="preflight__item"
      data-sev={issue.severity}
      data-click={clickable}
      onClick={() => { if (issue.elementId && onSelect) onSelect(issue.elementId); }}
      title={clickable ? `Select ${issue.elementName}` : undefined}
    >
      <span className="preflight__mark" data-sev={issue.severity}>{MARK[issue.severity]}</span>
      <span className="preflight__body">
        <span className="preflight__msg">{issue.message}</span>
        {issue.remedy && <span className="preflight__remedy">{issue.remedy}</span>}
        {issue.measurement && <span className="preflight__measure">{issue.measurement}</span>}
      </span>
    </li>
  );
}

export { TONE };
