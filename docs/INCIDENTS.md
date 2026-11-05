# Incident log

One row per production incident. Add a row when an incident is opened; fill the
resolution and follow-up when it closes. Keep it factual: what happened, what
users saw, what we changed. Do not paste secrets, customer data, or full stack
traces here.

Owner: project owner. Started: 2026-11-05.

## Severity

| Level | Meaning | Response |
|---|---|---|
| SEV1 | The app or cloud save/load is down for everyone, or data loss is possible | stop other work, fix first, notify the owner immediately |
| SEV2 | A core feature is broken for many users (sign-in, billing, cloud sync) | fix within the same day, notify the owner |
| SEV3 | A feature is degraded for some users, or a security control failed closed | fix within the week |
| SEV4 | Cosmetic or single-user issue with a workaround | normal queue |

## Log

| ID | Date (UTC) | Severity | Summary | Detected by | Impact | Resolution | Follow-up |
|---|---|---|---|---|---|---|---|
| - | - | - | No production incidents recorded yet. | - | - | - | - |

## Process

1. **Detect.** Today this is owner or user report plus the structured logs and
   edge analytics. There is no synthetic uptime alert yet (SEC-15).
2. **Contain.** Prefer the smallest reversible action: disable the failing
   route or feature, roll back the Worker deploy, or revoke a leaked credential
   (see `docs/RUNBOOK-SECRETS.md`). Do not delete data to make a symptom go
   away.
3. **Communicate.** Tell the owner what users can and cannot do right now, and
   when the next update will be. Do not publish a reliability number that the
   F2/F4 evidence does not support.
4. **Fix.** Ship the smallest correct change with the gate that would have
   caught it.
5. **Post-mortem.** Within a week for SEV1/SEV2: cause, blast radius, what
   detected it (or why nothing did), and the follow-up rows added to the
   security register or this log.

## Related runbooks

- `docs/RUNBOOK-SECRETS.md` - rotating a leaked secret with zero downtime.
- `docs/SECURITY-REGISTER.md` - accepted risks and their review dates.
- `docs/RELIABILITY-TARGETS.md` - the internal SLOs an incident is measured
  against.
