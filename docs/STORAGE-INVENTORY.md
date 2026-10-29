# Storage and Cookie Inventory

Task S-2 (audit directive 2026-10-18, section 8.2). Every cookie and every
browser storage key this product touches, with its purpose and category.

Categories:

- **necessary** - the site cannot work without it. Strictly needed for a
  feature the visitor asked for (sign-in, saving a project, remembering a
  setting), or required to deliver the page securely.
- **optional** - the site works fully without it. Loaded or written only
  after the visitor says yes.

The consent choice itself is necessary (it is how the site remembers the
answer). Bump `INVENTORY_VERSION` in `js/consent.js` whenever a row is added
or changes category; every visitor is asked again after a version change.
The server reads that same number back out of the cookie, so bump
`CONSENT_INVENTORY_VERSION` in `worker.js` and `serve.cjs` in the same
change - `tools/qa-consent.cjs` phase S fails the build if the three drift.

Enforced by `tools/qa-consent.cjs` phase S: any `localStorage` /
`sessionStorage` / cookie key written by shipped code that is not listed here
fails the gate.

## Cookies

| Name | Set by | Purpose | Category |
|---|---|---|---|
| `mmgr_session` | server (`src/auth/session.js`) | Keeps you signed in. HttpOnly, Secure, SameSite=Lax - never readable by page scripts. | necessary |
| `mmgr_consent_a` | `js/consent.js` | Carries your cookie choice to the server so the security policy can allow or block the analytics script. Holds the inventory version and the moment you chose, so the server can tell a current choice from an old one without asking the browser. | necessary |
| Cloudflare `/cdn-cgi/` challenge cookies | Cloudflare edge | Bot protection and DDoS defence. Set by the network, not by this site's code. | necessary |

## localStorage - account and app shell

| Key | Purpose | Category |
|---|---|---|
| `mmgr_consent` | Your cookie choice (`{v, iv, analytics, ts}`). | necessary |
| `mmgr_theme` | Dark or light appearance. | necessary |
| `mmgr_sidebar` , `mmgr_sidebar_backend` | Sidebar layout preference. | necessary |
| `mmgr_cross_project` | Admin cross-project search preference. | necessary |
| `mmgr_projects` | Project list kept on this device. | necessary |
| `mmgr_admin_projects` | Projects created or published on this device. | necessary |
| `mmgr_admin_pass_hash` | Admin password check (scrambled form, never the password). | necessary |
| `mmgr_admin_setup` | Whether admin access is set up on this device. | necessary |
| `mmgr_admin_session` | Admin signed-in flag on this device. | necessary |
| `mmgr_admin_cloud_code` | Cached admin cloud code. | necessary |
| `mmgr_restore_recap` | One-time flag so "What your code brought back" (the restore recap) is shown once after a restore instead of on every panel entry. Session only: set after the recap is seen, removed as soon as it is read. | necessary |
| `mmgr_current_project` | The project you had open last. | necessary |
| `mmgr_state_<id>` | A project's full data. | necessary |
| `mmgr_unlocked_<id>` | Whether a project was unlocked on this device. | necessary |
| `mmgr_scope_<id>` | Your access level on a project (full or view only). | necessary |
| `mmgr_cloud_id_<id>` | Links a local project to its cloud copy. | necessary |
| `mmgr_cloud_bond_<id>` | Cloud link record for a project. | necessary |
| `mmgr_cloud_code_<id>` , `mmgr_cloud_ecode_<id>` , `mmgr_cloud_escope_<id>` | Owner and editor codes cached for cloud projects. | necessary |
| `mmgr_demos_hidden` | Whether demo projects are hidden. | necessary |
| `mmgr_device_id` | Anonymous id that ties cloud saves to this device. | necessary |
| `mmgr_mcp_toggle_<id>` | MCP connector preference per project. | necessary |
| `mmgr_signin_next` | Page to return to after signing in. | necessary |
| `mmgr_admin_recovery_created_at` , `mmgr_admin_recovery_hash` , `mmgr_admin_recovery_attempts` , `mmgr_admin_recovery_locked_until` | Admin recovery code state and its retry lockout. | necessary |
| `mmgr_recent_codes` | Recently used access codes, for quick re-entry. | necessary |
| `mmgr_cloud_last_seen_<id>` | Last time a cloud project was seen on this device. | necessary |
| `mmgr_cloud_pending_ecode_<id>` | An editor code waiting to be confirmed. | necessary |
| `mmgr_offline_copy_<id>` | Marks an offline copy of a cloud project. | necessary |
| `mmgr_pool_pending_<id>` | Cloud writes waiting for the connection to return. | necessary |
| `mmgr_team_cache` | Your pending invitations and your "Shared with me" projects, kept on this device so the bell count and the panel open straight away instead of waiting on a fresh load. Refreshed about once a minute while the app is open. | necessary |
| `mmgr_theme_backend` | Retired theme-sync flag, kept so old devices migrate cleanly. | necessary |
| `mmgr_glass_mode` | Glass appearance preference. | necessary |
| `mmgr_palette` | Colour palette choice (gold or rose). | necessary |
| `mmgr_view_mode` | Flat or 3D view preference. | necessary |
| `mmgr_float_<id>` | Floating panel positions. | necessary |
| `mmgr_vp_<id>` | Viewport preferences per panel. | necessary |
| `mmgr_journal` | Project journal entries. | necessary |
| `mmgr_err_report` , `mmgr_err_webhook` | Error report contents and the address they are sent to (opt-in debugging). | necessary |
| `mmgr_sync_identity` | Signed-in Google identity for sync. | necessary |
| `mmgr_sync_clientid` | Google client id used for sync. | necessary |
| `mmgr_sync_mdu` | Sync "made data update" acknowledgement. | necessary |
| `mmgr_sync_suggest` | Set when the sync suggestion has been dismissed on this device. | necessary |
| `mmgr_ai_size` | Assistant window size. | necessary |
| `mmgr_byo_ai` | Bring-your-own-key connection preference. | necessary |
| `mmgr_errors_webhook` | Error report webhook address (opt-in debugging). | necessary |
| `mmgr_perf_mode` , `mmgr_perf_nudge` | Performance mode preference and its one-time prompt. | necessary |
| `mmgr_drive_token` , `mmgr_drive_token_exp` , `mmgr_drive_auto` , `mmgr_drive_last` , `mmgr_drive_granted` , `mmgr_drive_enc` | Google Drive backup connection and its state. Opt-in feature; nothing is stored until you connect Drive. | necessary |

## localStorage - calculator

| Key | Purpose | Category |
|---|---|---|
| `mmgr_calc_units` | Metric or imperial. | necessary |
| `mmgr_calc_tabs` | Which calculator tabs are open. | necessary |
| `mmgr_calc_size` | Calculator panel size. | necessary |
| `mmgr_calc_fx` | Exchange rates you entered. | necessary |
| `mmgr_calc_estimates` | Saved estimates. | necessary |
| `mmgr_calc_rate_sheets` | Rate sheets. | necessary |
| `mmgr_calc_books` , `mmgr_calc_book_active` , `mmgr_calc_jic_default` | Rate books and which one is active. | necessary |
| `mmgr_calc_prelims` | Preliminaries settings. | necessary |
| `mmgr_calc_locpacks` | Local packs. | necessary |
| `mmgr_calc_rollup` , `mmgr_calc_boq` , `mmgr_calc_biz_name` , `mmgr_calc_family` | Estimate breakdowns and business details. | necessary |
| `mmgr_calc_wstamps` | Work-save timestamps. | necessary |
| `mmgr_rfq_draft` | Bill-of-quantities lines handed from the calculator to the Procurement tab to write a request for quotation. Cleared when you dismiss it. | necessary |
| `mmgr_po_counter` | Purchase-order number sequence for the Procurement tab (PO-0001, PO-0002, ...). | necessary |
| `mmgr_calc_brand` , `mmgr_calc_doccounter` | Branding and document numbering. | necessary |
| `mmgr_calc_history` , `mmgr_calc_ai_chats` | Estimate history and assistant chats. | necessary |
| `mmgr_calc_guide_open` , `mmgr_calc_tour_done` , `mmgr_calc_brand_open` | Guide and tour state. | necessary |
| `mmgr_flag_calcUnitFlag` | Kill switch for the unit conversion feature. | necessary |

## sessionStorage

| Key | Purpose | Category |
|---|---|---|
| `mmgr_drive_pass` | Drive backup password, kept only while the tab is open. | necessary |

## IndexedDB

| Name | Purpose | Category |
|---|---|---|
| `mmgr_voice` | Voice input recordings held briefly for dictation. Cleared after use. | necessary |

## Cache API

The Cache API holds response bodies the browser keeps on this device. It is
origin-scoped, survives a reload, and is cleared by "Clear site data".

| Cache name | Purpose | Category |
|---|---|---|
| `mmgr-ratebook-v1` | The rate book you opened, cached for offline use. Written only after a signed-in load of the rate book (all 811 planning rates) and deleted on sign-out, so the next person on this device does not inherit it. | necessary |
| `mmgr-shell-v<number>` | The app shell: the pages, scripts and styles the service worker keeps so the app opens with no network. Replaced on each new version. | necessary |
| `mmgr-whisper-model-v1` | The speech model the voice input downloads once, so dictation still works offline. | necessary |

## Optional (only after the visitor says yes)

| Item | What it is | Category |
|---|---|---|
| Cloudflare Web Analytics beacon (`static.cloudflareinsights.com`) | Counts page visits and views. Cookieless by the provider's design; no personal profiles. Blocked by the site's security policy until "Accept all" is chosen. | optional |
