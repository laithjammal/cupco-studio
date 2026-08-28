/**
 * @cupco/geometry — the shared cup geometry engine.
 *
 * Zero runtime dependencies by design: this same code runs in the browser for
 * the 3D preview, in Node for the export worker, and in the test runner. One
 * implementation means the customer's 3D cup and the printer's fan cannot
 * drift apart.
 */
export * from './types';
export * from './frustum';
export * from './mapping';
export * from './fan';
export * from './profiles';
export * from './path-warp';
export * from './template';
export * from './elevation';
