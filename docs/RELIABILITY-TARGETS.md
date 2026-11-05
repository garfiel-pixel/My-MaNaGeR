# Reliability targets (internal)

Status: internal targets only. **No number in this file is a public or marketing
claim** until the F2 load test (wave 3.1) and the F4 restore drill (wave 3.2)
exist and the measured result is recorded beside it.

Owner: project owner. Last reviewed: 2026-11-05.

## Service level objectives

| Surface | Metric | Target | Notes |
|---|---|---|---|
| `/api/health` | availability | 99.9% per calendar month | roughly 43 minutes of downtime per month |
| `/api/health` | latency | p95 under 300 ms | measured at the edge, excluding client network |
| Authenticated cloud reads (`/api/cloud/*`) | latency | p95 under 500 ms | D1 + R2 round trip |
| All API routes | server error rate | under 0.5% of responses are 5xx | excludes deliberate 4xx refusals |
| Cloud save / load | durability | no acknowledged write is lost | R2 object versioning + D1 Time Travel |

## Recovery objectives (pending the drill)

| Objective | Target | How it is met |
|---|---|---|
| RTO (time to restore) | 1 hour | D1 Time Travel restore plus R2 re-link, run from the restore runbook |
| RPO (acceptable data loss) | 5 minutes | D1 Time Travel point-in-time window |

These are **not** confirmed until the F4 drill is run and timed. The drill
record belongs in `docs/RESTORE-DRILL-<date>.md` with the measured RTO/RPO, the
operator, and the exact commands used.

## Measurement and gaps

- Edge analytics and the structured logs in `src/lib/observe.js` are the
  current source for error rate and latency.
- There is **no synthetic uptime monitor and no public status page yet**
  (SEC-15, owner decision on vendors). Until one exists, availability is
  measured after the fact, not alerted in real time.
- The load test (F2) publishes p50/p95/p99 per scenario under `load/results/`.
  First run: `2026-11-05T22-24-47Z-2151d86.json` - health p95 79 ms against the
  300 ms target, 0 5xx, 0 429. The cloud arms (load p95 796 ms, save p95
  1287 ms) are local dev-server figures: every request pays the 100k-round
  owner-code KDF and the local isolate serialises it, so they are NOT a
  production claim. A staging run is still owed before any of this is quoted
  outside the repo.

## Review

Review this file after the F2 and F4 evidence lands, and at least once a
quarter. Changing a target requires the same deliberate-review note as the
security register.
