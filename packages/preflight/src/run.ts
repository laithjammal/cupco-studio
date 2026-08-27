/**
 * Running preflight.
 */

import { deriveFrustum } from '@cupco/geometry';
import type { CupProfile, FrustumGeometry } from '@cupco/geometry';
import { ALL_RULES } from './rules';
import type { Rule } from './rules';
import { PREFLIGHT_DEFAULTS } from './types';
import type {
  PreflightDesign, PreflightIssue, PreflightOptions, PreflightReport, Severity,
} from './types';

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function runPreflight(
  design: PreflightDesign,
  profile: CupProfile,
  options: PreflightOptions & { geom?: FrustumGeometry; rules?: Rule[] } = {},
): PreflightReport {
  const geom = options.geom ?? deriveFrustum(profile.dimensions);
  const ctx = {
    design, profile, geom,
    options: { ...PREFLIGHT_DEFAULTS, ...options },
  };

  const issues: PreflightIssue[] = [];
  for (const rule of options.rules ?? ALL_RULES) {
    // One broken rule must not take the whole report with it: a preflight that
    // reports nothing looks exactly like a preflight that found nothing.
    try {
      issues.push(...rule(ctx));
    } catch (e) {
      issues.push({
        rule: 'preflight-internal',
        severity: 'warning',
        message: `A preflight check failed to run: ${(e as Error).message}`,
        remedy: 'Treat this design as unchecked and inspect it by eye.',
      });
    }
  }

  // Most severe first, and stable within a severity so the list does not
  // reshuffle under the operator between runs.
  issues.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const infos = issues.filter((i) => i.severity === 'info').length;

  return { issues, passed: errors === 0, errors, warnings, infos };
}

/** One-line summary for a status bar. */
export function summarise(report: PreflightReport): string {
  if (report.errors > 0) {
    return `${report.errors} ${report.errors === 1 ? 'problem blocks' : 'problems block'} export`;
  }
  if (report.warnings > 0) {
    return `${report.warnings} ${report.warnings === 1 ? 'warning' : 'warnings'} — safe to export`;
  }
  return 'Ready to print';
}
