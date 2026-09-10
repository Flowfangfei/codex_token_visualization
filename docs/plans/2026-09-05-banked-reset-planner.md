# Banked reset planning

## Objective

Maximize estimated work served before the last known reset expiry plus one quota
cycle, using recent measured, model-calibrated quota demand. Benefits are additional
quota percentage points relative to waiting for natural resets (100 points is one
full pool). Equivalent and raw Token projections are separate display-only measures,
not cash savings, task quality or a fixed subscription Token capacity.

## Inputs and scope

- Use sanitized available-credit statuses and individual expiry timestamps.
- Reuse the existing model-aware, cross-segment quota fit and recent weighted rate.
- Preserve independent provider/window histories. Simulate the provider's full
  weekly pool, not a user-selected model-specific window.
- Only schedule known full resets with known expiries and matching available counts.
- Stale account snapshots (six hours), weak fits or insufficient intervals produce
  conditional advice, never an invented token capacity or exact schedule.
- Recently material models need individual sample coverage and calibration checks;
  new models do not inherit the old pooled model weight. Do not use API prices as
  subscription multipliers or impose an arbitrary fourfold weight cap. See README
  for coverage thresholds, drift guards and the limits of equivalent Tokens.
- The plan uses the existing weekly-or-longer view. Short-window throttling and
  other products sharing the account can reduce actual served work.

## Search

The original beam search has been replaced by an exact time-grid dynamic program.
After a full reset, remaining capacity is always 100 and the next natural reset is
determined by its timestamp. Retain the best path for each credit index and last-reset
timestamp, without percentage buckets or beam pruning. Complexity is O(K*N^2).
See [optimal-control derivation](2026-09-05-reset-optimal-control.md) for the recurrence,
proof, continuous-time supply bound, closed-form special cases and stochastic limits.

Natural resets refill rather than accumulate capacity. Restarting resets change the
next natural boundary. Equal-work results prefer fewer resets and then less discarded
capacity. Default resolution is half an hour plus deadline/natural-reset events; large
inventories coarsen time explicitly rather than dropping states. The certificate is
grid-scoped unless the schedule reaches a valid continuous-time upper bound.

The bounded horizon is 60 days; at most 24 known credits enter each calculation.
Deferred or unrecognized credits are reported. After expiry, already-restored quota
remains usable until the simulated period reset, hence the one-cycle tail.

## Provider semantics

Codex: a full reset refreshes the 5-hour and weekly windows and changes the weekly
reset date. Model immediate resumed work as a new weekly cycle. Offer-specific scope
and the actual reset date must still be read again after use.
Source: https://help.openai.com/en/articles/20001498-how-banked-codex-resets-work

Grok: current read-only RPC returns inventory and expiry but does not establish the
next-period effect. Compare fixed-calendar and restarted-cycle scenarios; the UI
must label these as assumptions, not confirmed schedules.

## Output and refresh

An independent planner view shows next action, no-reset/with-reset work estimates,
unused credits, lost balance, per-credit schedule and 0.7x/1x/1.3x demand scenarios.
These are sensitivity scenarios, not confidence intervals. Planning is read-only.
When exhaustion is expected within a day, a separate lexicographic objective maximizes
the next 24 hours first and the full horizon second, showing any long-term tradeoff.
Historical three-day blocks stress-test the fixed schedule and a causal exhaustion
response against identical demand paths; intraday bursts remain labelled assumptions.
When the normal pace cannot use the stock, search between 1x and 8x demand for a
feasible reference workload that uses each included reset with at most 5% discarded
balance. Enforce both constraints during the search: paths that miss a credit's
deadline or discard more than 5% are infeasible. Do not substitute a higher-serving
plan that only uses part of the inventory. Use six binary refinements after
bracketing; this is not a global minimum
claim. Compare against the no-reset baseline at that same increased workload. Only
show this as an optional scenario when the user has additional useful work.
All searches execute in a Web Worker so a larger inventory does not block navigation.
Page entry reads the latest usage/quota and credit payloads; the existing all-source
export updates inputs, then recomputes. No reset is redeemed by this feature.

## Verification

Tests cover expiry filtering, count mismatch, missing/weak/stale calibration, empty
inventory, natural refill vs extra capacity, restarted cycles, low demand, multiple
same-day resets, expiry margins and baseline dominance. UI checks cover desktop,
mobile, pending/error states, provider switching and global-refresh recalculation.
Clustered-expiry regression cases also verify full-stock feasibility under small
changes in sampling time and pace, plus explicit infeasibility at insufficient pace.
An independent exhaustive event simulator verifies grid optimality; a seeded 100-case
comparison found 43 strict improvements over the old beam search and no regressions.
