/* ============================================================
   My MaNaGeR MCP — Cloud API client
   ------------------------------------------------------------
   HTTP client for the Worker API endpoints. Enables the MCP
   server to read/write live cloud projects via:
     GET  /api/cloud/projects/:id/load   (read project state)
     POST /api/cloud/projects/:id/save   (write project state)
     GET  /api/cloud/projects             (list cloud projects)
     POST /api/auth/me                    (verify session)

   Auth headers:
     X-Owner-Code  — full access (owner)
     X-Editor-Code — scoped access (editor)

   Safety: all writes still go through validate.mjs + two-phase
   approval. The cloud API is the TRANSPORT, not a bypass.
   ============================================================ */

/**
 * Load a project from the cloud.
 * @param {string} baseUrl - Worker URL (e.g. https://my-manager.workers.dev)
 * @param {string} projectId - Cloud project ID
 * @param {string} [ownerCode] - Owner code for auth
 * @param {string} [editorCode] - Editor code for auth (scoped)
 * @returns {Promise<{ok: boolean, state?: object, error?: string}>}
 */
export async function cloudLoadProject(baseUrl, projectId, ownerCode, editorCode) {
  const headers = { 'Accept': 'application/json' };
  if (ownerCode) headers['X-Owner-Code'] = ownerCode;
  if (editorCode) headers['X-Editor-Code'] = editorCode;

  try {
    const res = await fetch(baseUrl + '/api/cloud/projects/' + encodeURIComponent(projectId) + '/load', {
      method: 'GET',
      credentials: 'same-origin',
      headers
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || 'HTTP ' + res.status };
    }
    return { ok: true, state: data.state || data.project };
  } catch (e) {
    return { ok: false, error: 'Network error: ' + (e.message || 'unknown') };
  }
}

/**
 * Save project state to the cloud.
 * @param {string} baseUrl - Worker URL
 * @param {string} projectId - Cloud project ID
 * @param {object} state - Full project state to save
 * @param {string} ownerCode - Owner code for auth
 * @param {string} [editorCode] - Editor code for auth (scoped)
 * @returns {Promise<{ok: boolean, savedAt?: string, error?: string}>}
 */
export async function cloudSaveProject(baseUrl, projectId, state, ownerCode, editorCode) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  if (ownerCode) headers['X-Owner-Code'] = ownerCode;
  if (editorCode) headers['X-Editor-Code'] = editorCode;

  try {
    const res = await fetch(baseUrl + '/api/cloud/projects/' + encodeURIComponent(projectId) + '/save', {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify({ state })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || 'HTTP ' + res.status };
    }
    return { ok: true, savedAt: data.savedAt };
  } catch (e) {
    return { ok: false, error: 'Network error: ' + (e.message || 'unknown') };
  }
}

/**
 * List cloud projects accessible with the given codes.
 * @param {string} baseUrl - Worker URL
 * @param {string} [ownerCode] - Owner code
 * @param {string} [editorCode] - Editor code
 * @returns {Promise<{ok: boolean, projects?: Array<{id: string, name?: string}>, error?: string}>}
 */
export async function cloudListProjects(baseUrl, ownerCode, editorCode) {
  const headers = { 'Accept': 'application/json' };
  if (ownerCode) headers['X-Owner-Code'] = ownerCode;
  if (editorCode) headers['X-Editor-Code'] = editorCode;

  try {
    const res = await fetch(baseUrl + '/api/cloud/projects', {
      method: 'GET',
      credentials: 'same-origin',
      headers
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || 'HTTP ' + res.status };
    }
    return { ok: true, projects: data.projects || [] };
  } catch (e) {
    return { ok: false, error: 'Network error: ' + (e.message || 'unknown') };
  }
}

/**
 * Verify the session/auth status.
 * @param {string} baseUrl - Worker URL
 * @returns {Promise<{ok: boolean, user?: object, error?: string}>}
 */
export async function cloudAuthMe(baseUrl) {
  try {
    const res = await fetch(baseUrl + '/api/auth/me', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || 'Not signed in' };
    }
    return { ok: true, user: data.user };
  } catch (e) {
    return { ok: false, error: 'Network error: ' + (e.message || 'unknown') };
  }
}
