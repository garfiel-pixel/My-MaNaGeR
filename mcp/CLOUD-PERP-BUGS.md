Cloud per-project MCP bugs - FIXED 2026-09-07 (Session 12)
=========================================================

All 4 bugs found during the 2026-08-24 MCP cloud expansion have been fixed.
Verified: node mcp/qa-mcp.cjs → 49/49 PASS.

1. ✅ FIXED — mmgr_list_projects tool now lists cloud projects.
   Root cause: listProjectsTool() called cloudListProjects() without await —
   the Promise was never resolved, so cloud results were always empty.
   Fix: made listProjectsTool async, added await.

2. ✅ FIXED — Proposal tokens now carry the resolved cloud project identity.
   Root cause: proposeChangeTool stored project: p._cloud ? null : p.file —
   for cloud mode, null was stored, so approve/revert fell back to the default
   CLOUD_PROJECT_ID blindly (wrong project when a different one was staged).
   Fix: token now stores _cloudProjectId + _cloudProjectLabel from the resolved
   project at propose time; approveChangeTool uses those first.

3. ✅ FIXED — Sidecar changelog path consistently uses the resolved project id.
   Root cause: In approveChangeTool and revertChangeTool, the sidecar changelog
   file path was built from CLOUD_PROJECT_ID in some branches instead of the
   actually-resolved project id — edits to different cloud projects could land
   in the same sidecar file.
   Fix: all sidecar paths now derive from projectForSave.projectId (approve) or
   p.project.projectId (revert), falling back to stored _cloudProjectId.

4. ✅ FIXED — Duplicate dispatch cases removed.
   Root cause: mmgr_list_cloud_projects and mmgr_choose_cloud_project appeared
   twice in the handleCall switch (duplicate case clauses).
   Fix: deduplicated.

QA: 49/49 PASS (H2 updated from 31→33 tools to reflect the 2 cloud-discovery tools).
