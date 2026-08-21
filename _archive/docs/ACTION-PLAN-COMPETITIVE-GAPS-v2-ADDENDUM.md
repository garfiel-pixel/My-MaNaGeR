# My MaNaGeR — Action Plan Addendum v2 (Weather + New Gaps)

**This is additive to ACTION-PLAN-COMPETITIVE-GAPS.md — do not replace it.** Phases 1-6
in the original file are unchanged. This adds Phase 7 and five new gap items informed by
fresh research into how BuilderTrend, Procore, and construction-weather-specific tools
(Projul, Perry Weather, SmartPM, WeatherBuild) handle this space — and where they fall
short.

---

## Why this matters (research findings)

- Weather delays impact roughly 45% of construction projects worldwide every year —
  this isn't a nice-to-have, it's one of the biggest universal disruption categories in
  the industry.
- The best existing tool in this space (BuilderTrend) overlays forecasts on the schedule
  calendar but stops there: subcontractor notifications are manual, there's no LD/contract
  notice automation, and critically — **no portfolio-level weather dashboard** across
  multiple projects.
- Dispute/claim defense depends on daily logging starting on day one, not reconstructed
  after the fact — this is a workflow gap, not just a data gap.
- Weather-sensitive work should carry distributed float at multiple points in the
  schedule (e.g., before concrete pours), not just stacked at the project's end.

This is a clean opening: nobody at your price tier combines weather forecasting +
schedule float + risk register + budget/LD exposure + portfolio view in one place.

---

## Phase 7 — Weather-Aware Scheduling (new)

### 7.1 Weekly/Monthly Weather-Risk Forecast Panel
- Pull 7-16 day forecast from **Open-Meteo** (api.open-meteo.com/v1/forecast) — no API
  key required, free for non-commercial use up to 10,000 calls/day, plain JSON over HTTPS,
  callable directly from client-side JS. No PHP proxy needed.
- Each project stores a lat/long (or zip → geocode once via Open-Meteo's free geocoding
  endpoint, cache the result — don't re-geocode every load)
- Panel shows a week view and a month view: each day tagged against user-defined
  "weather-sensitive thresholds" (e.g., rain > 0.25in, wind > 25mph, temp < 35°F or > 95°F)
- Acceptance: opening a project's Schedule tab shows an at-a-glance weather-risk strip for
  the next 7 days, with a monthly rollup view available

### 7.2 Weather-Sensitive Task Tagging
- Extend WBS task model with an optional "weather-sensitive" flag + threshold type
  (rain/wind/temp/combination) — e.g., concrete pour, roofing, crane lifts, exterior paint
- When a tagged task's scheduled date overlaps a forecast day crossing its threshold,
  auto-flag it — this feeds directly into the Today Decision Engine (Phase 1.1) and Risk
  register, not a separate silo
- Acceptance: a concrete-pour task scheduled on a day forecast for heavy rain shows a
  flag in both the Schedule view and Today Decision Engine

### 7.3 Distributed Weather Float (not just end-of-schedule buffer)
- When generating/editing schedule baselines, prompt for weather float at key
  milestones (not just a single buffer at project end) — matches actual industry practice
  of front-loading float before weather-vulnerable activities
- Acceptance: schedule baseline tool supports adding float entries tied to specific tasks,
  not only a single trailing buffer

### 7.4 Weather Delay Daily Log (claim/dispute defense)
- One-tap daily log: today's actual conditions (auto-pulled from Open-Meteo's
  current-conditions endpoint) + a manual note field + which tasks were affected
- This is the "2 minutes a day" habit — pairs naturally with Phase 3.3 (PM Consistency
  Streaks) as a trackable habit
- Acceptance: daily log entries accumulate per project, exportable via existing Copy All
  feature as a dispute-ready record (date, conditions, affected tasks, note)

### 7.5 LD/Contract Exposure Tied to Weather
- If a project has a liquidated-damages clause value stored (new optional Budget/Charter
  field), sum LD exposure avoided by properly logged weather delay days vs. unlogged ones
- This is a real gap — nobody except enterprise-tier claims-specific tools (SmartPM,
  Perry Weather) connects weather logging directly to financial exposure, and those are
  add-on products, not built into the base PM tool
- Acceptance: Budget tab shows "weather days logged this project" and estimated LD
  exposure avoided, driven by 7.4's daily log

### 7.6 Portfolio-Level Weather Dashboard
- This is explicitly the gap BuilderTrend does NOT have. Cross-project rollup: which of
  your active projects face weather risk in the next 7 days, ranked by task
  weather-sensitivity count and severity
- Feeds into Phase 6.1 (Cross-Project Portfolio Health Rollup) as an additional ranking
  input, not a separate dashboard
- Acceptance: Project Dashboard shows a weather-risk indicator per project card, sourced
  from 7.1/7.2

**Phase 7 exit criteria:** weather data flows into existing Today Decision Engine, Risk
register, and Budget tab — this is not a standalone weather widget, it's wired into the
data model like everything else. Verify Open-Meteo calls are cached client-side
(sessionStorage, short TTL) to stay well under the 10,000/day free limit if usage grows.

---

## New gap items (21-25), informed by this research pass

### 21. Heat/Cold Safety Alert (LTIR reduction angle)
Real-world incident data shows heat-related injuries drive both safety and cost
penalties on projects that didn't account for weather risk in scheduling. Add a
simple threshold-based alert (extends 7.2's threshold system) specifically flagged as
a safety concern, not just a schedule concern — distinct icon/color so it doesn't get
lost among schedule flags. No tool at this price tier separates "weather affects the
schedule" from "weather could hurt someone" — worth keeping them visually distinct.

### 22. Schedule Reliability Index (SRI) card
Industry is moving toward this exact metric: percentage of planned tasks completed on
or before milestone dates. You already have the WBS/Schedule data to compute this
today — add it as a Health Score input and a standalone trend card. This is a
forward-looking metric name your target users may already recognize from industry
publications, which helps credibility.

### 23. Rolling Material Lead-Time Forecast
Industry best practice is now rolling 3-month material forecasts updated weekly, to
buffer supply chain disruption. This extends Phase 2.3 (Procurement Lead-Time Tracker)
— instead of a static one-time lead time per item, make it a rolling window that gets
revisited on a cadence, with a visible "last updated" staleness indicator so stale
procurement data doesn't silently go unnoticed.

### 24. Subcontractor Weather Notification (closes BuilderTrend's actual gap)
BuilderTrend flags weather risk but doesn't auto-notify subs — confirmed gap. Since
InfinityFree can send email via PHP mail() or a transactional email API on request
(not real-time push), auto-generate a notification-ready message when a weather-sensitive
task is at risk, for the PM to send (or auto-send via PHP mail if configured). Keep this
manual-trigger in v1 given InfinityFree's lack of reliable background jobs — don't
promise real-time push you can't deliver on this host.

### 25. On-Site Manual Weather Override
Hyperlocal jobsite conditions can differ meaningfully from API forecast data (this is
why dedicated on-site weather stations exist in the industry). Let a PM manually
override/annotate a day's actual conditions if they differ from the API forecast — feeds
the same daily log (7.4) as the dispute record, and keeps the tool honest that API data
is a forecast, not ground truth.

---

## Updated working agreement addition

- Weather features must degrade gracefully with zero configuration — a project with no
  lat/long set should show a clear "set project location to enable weather features"
  prompt, never a broken/blank panel.
- Cache all Open-Meteo responses client-side with a sensible TTL (e.g., 1 hour for
  forecast, 24 hours for geocoding) to stay within free-tier limits and reduce load time.
- Sequence Phase 7 after Phase 1 (Today Decision Engine must exist first, since 7.2 wires
  into it) — recommend running Phase 7 alongside Phase 2, not before it.
