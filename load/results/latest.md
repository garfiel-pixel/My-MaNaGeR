# Load test - 2026-11-05T22:24:47.714Z

Commit `2151d86` | v26.12.1 | win32 x64

Local wrangler dev with local D1 and R2, 20 owner codes rotated, concurrency 8, 20s per scenario.

| Scenario | n | ok | 429 | 5xx | p50 | p95 | p99 | max | req/s |
|---|---|---|---|---|---|---|---|---|---|
| health | 1200 | 1200 | 0 | 0 | 57.2 ms | 79.4 ms | 114.2 ms | 207.9 ms | 133.6 |
| shell | 600 | 600 | 0 | 0 | 268.8 ms | 319.8 ms | 331.5 ms | 342.2 ms | 29.9 |
| load | 200 | 200 | 0 | 0 | 784 ms | 796.3 ms | 805.5 ms | 811.8 ms | 2.6 |
| save | 200 | 200 | 0 | 0 | 313.7 ms | 1286.7 ms | 1337.1 ms | 1353.4 ms | 2.9 |

Targets (`docs/RELIABILITY-TARGETS.md`): `/api/health` p95 under 300 ms. These are local numbers; staging is measured separately and no number is public before F4.
