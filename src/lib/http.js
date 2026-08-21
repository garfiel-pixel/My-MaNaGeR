// Shared HTTP utilities extracted from worker.js.
// Every API module imports from here instead of duplicating helpers.

// JSON responses for the API — never the page CSP, always no-store.
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}
