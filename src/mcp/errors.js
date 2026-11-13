/* ============================================================
   MCP ERROR CODES — one FIXED taxonomy (MCP-AGENT-FIRST addendum A2, 2026-11-13)
   ------------------------------------------------------------
   Every `refused` entry from apply_changes / validate_changes, and every
   NON-applied entry in an accept apply report, carries a `code` drawn from
   MCP_ERROR_CODES. get_schema publishes the list so an agent can branch on a
   stable token instead of parsing prose.

   The set is FROZEN: to add a code, edit this array AND the test that pins its
   length (test/mcp-schema.test.mjs / AT23a) - never invent one at a call site.
   refusalCode() and applyResultCode() ALWAYS return a member of the set (the
   fallback is REFUSED), so membership is a structural guarantee, not a hope.
   ============================================================ */

export const MCP_ERROR_CODES = Object.freeze([
  'INVALID_INPUT',
  'NOT_A_SECTION',
  'OUT_OF_SCOPE',
  'NOT_WRITABLE',
  'USE_BUDGET_ARRAY',
  'USE_SET',
  'SERVER_MANAGED',
  'NOT_EDITABLE',
  'RECORD_NOT_FOUND',
  'MISSING_FIELD',
  'UNKNOWN_FIELD',
  'DERIVED_FIELD',
  'INVALID_TYPE',
  'STRING_TOO_LONG',
  'INVALID_DATE',
  'INVALID_ENUM',
  'STALE_BEFORE',
  'INVALID_REFERENCE',
  'DELETE_NOT_ALLOWED',
  'BUDGET_WRITE_REFUSED',
  'CONFLICT',
  'SKIPPED_ALREADY',
  'REFUSED'
]);

// Ordered most-specific first: the first matching rule wins, so a reason that
// names a stale `before` is STALE_BEFORE even though it also mentions a field.
const RULES = [
  [/stale before:/i, 'STALE_BEFORE'],
  [/derived field, recomputed/i, 'DERIVED_FIELD'],
  [/unknown field\. Allowed:/i, 'UNKNOWN_FIELD'],
  [/not one of:/i, 'INVALID_ENUM'],
  [/not a real calendar date/i, 'INVALID_DATE'],
  [/longer than \d+ characters/i, 'STRING_TOO_LONG'],
  [/expected (?:a string|a finite number|true or false|an array|an object)/i, 'INVALID_TYPE'],
  [/not a project section/i, 'NOT_A_SECTION'],
  [
    /outside the granted sections|out of the granted sections|outside the granted scope|out of the granted scope|out of scope/i,
    'OUT_OF_SCOPE'
  ],
  [/use the budget array/i, 'USE_BUDGET_ARRAY'],
  [/use a set \(/i, 'USE_SET'],
  [/the envelope is a single number/i, 'USE_SET'],
  [/server-managed and cannot be written/i, 'SERVER_MANAGED'],
  [/not writable through MCP/i, 'NOT_WRITABLE'],
  [
    /not an editable list|is a record list - use diffs or creates|not a list that accepts new records/i,
    'NOT_EDITABLE'
  ],
  [/not found in |record not found/i, 'RECORD_NOT_FOUND'],
  [/missing field|missing record|missing value|needs at least a name or title/i, 'MISSING_FIELD'],
  [
    /not deletable|not a deletable record list|phase still has child|budget line references|surviving task lists it|still has child tasks/i,
    'DELETE_NOT_ALLOWED'
  ],
  [/record already exists|record already absent|value already set/i, 'SKIPPED_ALREADY'],
  [/predecessor|tempId|is not unique|cycle|self/i, 'INVALID_REFERENCE'],
  [
    /not a valid field path|could not be set|is not an array list|is not an object section|unsafe field path|: invalid\b/i,
    'INVALID_INPUT'
  ],
  [/budget/i, 'BUDGET_WRITE_REFUSED']
];

export function refusalCode(text) {
  const s = String(text == null ? '' : text);
  for (let i = 0; i < RULES.length; i++) {
    if (RULES[i][0].test(s)) {
      return RULES[i][1];
    }
  }
  return 'REFUSED';
}

// An apply-report entry: `applied` carries no code; a skip is always
// SKIPPED_ALREADY; a conflict is classified by its reason, falling back to the
// generic CONFLICT token so the result is always a member of the set.
export function applyResultCode(result, reason) {
  if (result === 'applied') {
    return null;
  }
  if (result === 'skipped_already') {
    return 'SKIPPED_ALREADY';
  }
  const code = refusalCode(reason || '');
  return code === 'REFUSED' ? 'CONFLICT' : code;
}
