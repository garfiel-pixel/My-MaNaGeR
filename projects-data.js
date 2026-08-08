/* ============================================================
   My MaNaGeR — Public Projects Manifest
   Built by Garack.
   ------------------------------------------------------------
   THIS FILE IS PUBLIC. Every visitor's browser downloads it to
   build the dashboard, so it must NEVER contain a plaintext
   access code — only the SHA-256 hash of each code.

   You will not normally hand-edit this file. Instead:
     1. Open admin.html and manage projects there.
     2. Click "Download Public Data File" to get an updated
        copy of this exact file.
     3. Upload it to your site's root on InfinityFree (File
        Manager or FTP), overwriting the old one.
   That upload step is the "publish" step — nothing is live
   for other visitors until this file is replaced on the server.

   Fields per project:
     id          unique url-safe slug — also used to namespace
                 this project's localStorage keys, so keep it
                 stable once you've shared codes for it
     title       shown on the dashboard card
     description shown on the dashboard card
     status      "active" | "on-hold" | "completed" | "planning"
     file        path (relative to this file) to that project's
                 protected HTML file
     codeHash    SHA-256 hex hash of the access code, uppercased
                 before hashing — never the plaintext code
     roCodeHash  optional SHA-256 hex hash of a view-only code (same
                 uppercase normalization); visitors entering it unlock
                 the project read-only

   NOTE ON FORMAT: keys are double-quoted below (valid JSON
   inside a JS array) because the admin panel's "import live
   data" feature parses this array with JSON.parse(). Keep that
   format if you ever hand-edit this file.
   ============================================================ */
window.MMGR_PROJECTS = [
  {
    "id": "demo-project",
    "title": "Demo Project — Riverside Tower Renovation",
    "description": "A working example wired up end-to-end so you can test the unlock flow before adding your own projects. Contact the admin to get the access code.",
    "status": "active",
    "file": "project.html?id=demo-project",
    "codeHash": "5b583f9cc37f83fa78453b41c1516a1f23510fd367396523f36bd58b7dcb87f7",
    "roCodeHash": "852eb69ba700845b83817984dc535ada337ba11cc4a1d3b92bce1ae0b873cb5c"
  }
];