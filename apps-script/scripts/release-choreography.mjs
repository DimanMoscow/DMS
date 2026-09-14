// Bounded operational timeouts, not promises about external service availability.
// This module describes/rehearses order only; it has no live mutation transport.
export const ACTIVATION_STEPS = Object.freeze([
  ['close-readback', 60], ['drain', 420], ['drained-inventory', 60],
  ['stage-exact-head-readback', 90], ['staged-calendar-preview', 90],
  ['map-existing-57-readback', 60], ['protected-merge', 90], ['vercel-ready', 300],
  ['closed-get-runtime', 60], ['guarded-open-readback', 60],
  ['signed-read-only-smoke', 300], ['business-reconciliation', 120],
]);
export const ROLLBACK_STEPS = Object.freeze([
  ['close-readback', 60], ['drain', 420], ['drained-inventory', 60],
  ['restore-exact-56-head-readback', 90], ['restore-mapping-56-readback', 60],
  ['protected-web-restore', 300], ['vercel-ready', 300], ['closed-get-runtime', 60],
  ['guarded-open-readback', 60], ['safe-v56-signed-smoke', 180], ['business-reconciliation', 120],
]);
export function releaseBudget() {
  const sum = steps => steps.reduce((total, [, seconds]) => total + seconds, 0);
  const activationSeconds = sum(ACTIVATION_STEPS);
  const rollbackSeconds = sum(ROLLBACK_STEPS);
  return {activationSeconds, rollbackSeconds, slackSeconds: 900,
    requiredSeconds: activationSeconds + rollbackSeconds + 900};
}
export function admitWindow({availableSeconds, downstreamReady, scheduledConflict}) {
  const budget = releaseBudget();
  return {...budget, admitted: downstreamReady === true && scheduledConflict === false &&
    budget.requiredSeconds <= 1800 && Number.isFinite(availableSeconds) &&
    availableSeconds >= budget.requiredSeconds};
}
export function rehearse({failureAt = null} = {}) {
  const trace = [];
  for (const [step, seconds] of ACTIVATION_STEPS) {
    trace.push({phase: 'activation', step, maximumSeconds: seconds});
    if (failureAt === step) {
      trace.push(...ROLLBACK_STEPS.map(([name, maximumSeconds]) =>
        ({phase: 'rollback', step: name, maximumSeconds})));
      return {trace, outcome: 'ROLLBACK_REHEARSED', productionMutations: 0};
    }
  }
  return {trace, outcome: 'ACTIVATION_REHEARSED', productionMutations: 0};
}
