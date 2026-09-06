# Financial formulas v1

Nine shared anchors replace the fixed 203/503 financial horizon. FILTER selects
occupied record IDs, QUERY aggregates history once per source/measure, and vector
lookups reuse those totals. Selectors grow with the sheet grid; grouped work is
bounded by actual records, including gaps. LET caches the single-training debt
inputs. This avoids repeated per-client full-history SUMIFS. Native Sheets tests
cover old boundaries, distant rows, current production-sized data and tenfold data.

Only Clients F:J and Blocks I:J/N:O are recomputed. Existing known formula cells
in Clients E are converted to an open-ended block lookup; literal format choices
are preserved. All IDs, prices, dates, statuses, notes, payments and Journal rows
remain unchanged. The existing core single-training debt calculation is included;
the old production J5 anchor had omitted that supported path.

The native batch changes formula ownership atomically. Reapplication is a no-op
when the exact anchors and format formulas already match. A separate numeric
post-check compares all client/block outputs with a full independent aggregation
of Payments and Journal. Formula shape alone is not success.

Production use requires a current applied ledger, fresh verified private backup,
old-execution drain, full P1 gates and read-back. An offline plan does not prove
live state. Old v50 template writers must not run after migration; rollout uses
the reviewed v51 writers that preserve anchor ownership. Roll forward after cf2
acceptance; preserve the pre-migration private formula snapshot for recovery.

References: [LET](https://support.google.com/docs/answer/13190535?hl=en),
[QUERY](https://support.google.com/docs/answer/3093343?hl=en).
