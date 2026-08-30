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
     3. Commit it to your repository and deploy via
        `npx wrangler deploy` (Cloudflare Workers static assets).
   That deploy step is the "publish" step — nothing is live
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
    "id": "demo-filled",
    "title": "Riverside Tower Renovation (Demo)",
    "description": "A fully populated 18-month construction project with all sections filled out. View-only to show what a real project looks like.",
    "status": "active",
    "file": "project.html?id=demo-filled",
    "codeHash": "",
    "roCodeHash": "",
    "demo": true,
    "demoType": "filled"
  },
  {
    "id": "demo-empty",
    "title": "Blank Template Project",
    "description": "An empty project you can edit and explore. Try filling in the charter, adding tasks, and tracking budget.",
    "status": "planning",
    "file": "project.html?id=demo-empty",
    "codeHash": "",
    "roCodeHash": "",
    "demo": true,
    "demoType": "empty"
  },
  {
    "id": "demo-project",
    "title": "QA Demo Project",
    "description": "Seed-test demo project used by the QA battery.",
    "status": "active",
    "file": "project.html?id=demo-project",
    "codeHash": "5b583f9cc37f83fa78453b41c1516a1f23510fd367396523f36bd58b7dcb87f7",
    "roCodeHash": "852eb69ba700845b83817984dc535ada337ba11cc4a1d3b92bce1ae0b873cb5c",
    "demo": true,
    "demoType": "filled"
  }
];