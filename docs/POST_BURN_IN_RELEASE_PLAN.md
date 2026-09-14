# Candidate rollout — two-phase contract

See [V57_TWO_PHASE_PROOF](V57_TWO_PHASE_PROOF.md) for the maintained generic
sequence. Pre-deploy a Web artifact compatible with both exact identities before
closing ingress. Stage/read back the complete approved HEAD, switch the existing
numbered mapping, verify GET/runtime, then guarded OPEN and signed read-only smoke.
Rollback restores both HEAD and mapping while retaining the compatible Web.

Never run signed POST smoke through a closed interlock; never shorten either
420-second drain. Keep concrete operational evidence and window assignments
private. This document is not deployment authorization.
