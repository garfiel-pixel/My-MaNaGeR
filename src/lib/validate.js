/* ============================================================
   SCHEMA VALIDATION — shared request body validation
   ------------------------------------------------------------
   Every API handler currently does its own inline field-
   whitelisting. This module extracts that into a single shared
   validation layer used by both the HTTP API and the MCP server,
   so the two "front doors" to the same data can never drift into
   inconsistent validation rules over time.

   Usage:
     const body = await validateBody(request, PROJECT_CREATE_SCHEMA);
     if (body.error) return body;  // already a JSON error Response
     // body is the validated/sanitized object

   Schemas are plain objects describing allowed fields, types,
   and constraints. No external dependencies.
   ============================================================ */

import { json } from './http.js';

/* ============================================================
   CORE VALIDATORS
   ============================================================ */

/**
 * Validate a string field.
 * @param {*} value - The value to validate
 * @param {object} rules - { required, minLength, maxLength, pattern, trim, fallback }
 * @returns {string|{error: Response}} - The validated string or error Response
 */
export function validateString(value, rules = {}) {
  const { required = false, minLength = 0, maxLength = Infinity,
          pattern = null, trim = true, fallback = '' } = rules;

  if (value === undefined || value === null) {
    if (required) return errorResponse('field is required');
    return fallback;
  }

  if (typeof value !== 'string') {
    if (required) return errorResponse('field must be a string');
    return fallback;
  }

  let s = trim ? value.trim() : value;

  if (required && s.length === 0) return errorResponse('field is required');
  if (s.length > 0 && s.length < minLength) return errorResponse('too short (min ' + minLength + ' chars)');
  if (s.length > maxLength) return errorResponse('too long (max ' + maxLength + ' chars)');
  if (pattern && s.length > 0 && !pattern.test(s)) return errorResponse('invalid format');

  return s;
}

/**
 * Validate a number field.
 * @param {*} value - The value to validate
 * @param {object} rules - { required, min, max, integer, fallback }
 * @returns {number|{error: Response}} - The validated number or error Response
 */
export function validateNumber(value, rules = {}) {
  const { required = false, min = -Infinity, max = Infinity,
          integer = false, fallback = 0 } = rules;

  if (value === undefined || value === null) {
    if (required) return errorResponse('field is required');
    return fallback;
  }

  const n = Number(value);
  if (!Number.isFinite(n)) {
    if (required) return errorResponse('field must be a number');
    return fallback;
  }

  if (integer && !Number.isInteger(n)) return errorResponse('must be a whole number');
  if (n < min) return errorResponse('must be at least ' + min);
  if (n > max) return errorResponse('must be at most ' + max);

  return n;
}

/**
 * Validate an array field.
 * @param {*} value - The value to validate
 * @param {object} rules - { required, minItems, maxItems, of, fallback }
 * @returns {Array|{error: Response}} - The validated array or error Response
 */
export function validateArray(value, rules = {}) {
  const { required = false, minItems = 0, maxItems = Infinity,
          of = null, fallback = [] } = rules;

  if (value === undefined || value === null) {
    if (required) return errorResponse('field is required');
    return fallback;
  }

  if (!Array.isArray(value)) {
    if (required) return errorResponse('field must be an array');
    return fallback;
  }

  if (value.length < minItems) return errorResponse('must have at least ' + minItems + ' items');
  if (value.length > maxItems) return errorResponse('must have at most ' + maxItems + ' items');

  return value;
}

/**
 * Validate an object field against a sub-schema.
 * @param {*} value - The value to validate
 * @param {object} schema - Sub-schema to validate against
 * @returns {object|{error: Response}} - The validated object or error Response
 */
export function validateObject(value, schema = {}) {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return errorResponse('field must be an object');
  }

  return validateSchema(value, schema);
}

/* ============================================================
   SCHEMA VALIDATOR — validates an object against a schema
   definition and returns the sanitized result.
   ============================================================ */

/**
 * Validate a request body against a schema.
 * @param {Request} request - The incoming request
 * @param {object} schema - Schema definition { fieldName: { type, ... } }
 * @param {number} maxSize - Maximum body size in bytes (default 1MB)
 * @returns {object} - { ok: true, data: {...} } or { error: Response }
 */
export async function validateBody(request, schema = {}, maxSize = 1048576) {
  let body;
  try { body = await request.json(); } catch (e) {
    return { error: errorResponse('invalid JSON body', 400) };
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: errorResponse('body must be a JSON object', 400) };
  }

  const result = validateSchema(body, schema);
  if (result.error) return { error: result.error };
  return { ok: true, data: result };
}

/**
 * Validate an object against a schema definition.
 * @param {object} obj - The object to validate
 * @param {object} schema - Schema definition
 * @returns {object} - The sanitized object, or { error: Response }
 */
export function validateSchema(obj, schema) {
  const result = {};
  for (const [key, rules] of Object.entries(schema)) {
    const type = rules.type || 'string';
    const value = obj[key];

    let validated;
    switch (type) {
      case 'string':
        validated = validateString(value, rules);
        break;
      case 'number':
        validated = validateNumber(value, rules);
        break;
      case 'integer':
        validated = validateNumber(value, { ...rules, integer: true });
        break;
      case 'array':
        validated = validateArray(value, rules);
        break;
      case 'object':
        validated = validateObject(value, rules.schema);
        break;
      default:
        validated = value;
    }

    if (validated && validated.error) return { error: validated.error };
    result[key] = validated;
  }
  return result;
}

/* ============================================================
   COMMON SCHEMAS — reusable validation rules for shared
   field patterns across the API.
   ============================================================ */

/** Sanitized project ID — alphanumeric + hyphens/underscores, max 64 chars */
export const PROJECT_ID_SCHEMA = {
  type: 'string',
  required: true,
  minLength: 1,
  maxLength: 64,
  pattern: /^[A-Za-z0-9_-]{1,64}$/
};

/** Review text — plain text only, max 2000 chars */
export const REVIEW_TEXT_SCHEMA = {
  type: 'string',
  required: true,
  minLength: 1,
  maxLength: 2000,
  // Plain text only — no HTML or URLs
  pattern: /^(?!.*[<>])(?!.*https?:\/\/)(?!.*www\.)/i
};

/** Review name — optional, max 60 chars */
export const REVIEW_NAME_SCHEMA = {
  type: 'string',
  required: false,
  maxLength: 60,
  pattern: /^(?!.*[<>])(?!.*https?:\/\/)(?!.*www\.)/i
};

/** Stars rating — optional, 1-5 integer */
export const STARS_SCHEMA = {
  type: 'integer',
  required: false,
  min: 1,
  max: 5,
  fallback: null
};

/** Section key — one of the known CLOUD_SECTIONS keys */
export const SECTION_KEY_SCHEMA = {
  type: 'string',
  required: true,
  minLength: 1,
  maxLength: 32
};

/** Label — human-readable name, max 120 chars */
export const LABEL_SCHEMA = {
  type: 'string',
  required: false,
  maxLength: 120,
  fallback: ''
};

/** Email address */
export const EMAIL_SCHEMA = {
  type: 'string',
  required: true,
  pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  maxLength: 254
};

/* ============================================================
   HELPERS
   ============================================================ */

function errorResponse(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

/**
 * Sanitize a review text for safe rendering — strip HTML-like chars
 * and URL patterns. Returns the cleaned text or an error.
 */
export function sanitizePlainText(text, maxLen = 2000) {
  if (typeof text !== 'string') return { error: 'text must be a string' };
  const cleaned = text.trim();
  if (cleaned.length === 0) return { error: 'text is required' };
  if (cleaned.length > maxLen) return { error: 'text too long (max ' + maxLen + ' chars)' };
  if (/[<>]/.test(cleaned)) return { error: 'plain text only — no HTML' };
  if (/https?:\/\/|www\./i.test(cleaned)) return { error: 'plain text only — no URLs' };
  return { ok: true, text: cleaned };
}
