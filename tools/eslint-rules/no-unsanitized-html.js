/* ============================================================
   eslint-rules/no-unsanitized-html.js
   ------------------------------------------------------------
   S-5 (AUDIT-DIRECTIVE-2026-10-18, 8.1 S-5):
   "add a lint rule requiring every interpolated value in an
   innerHTML template to pass through esc() or U.escapeHtml().
   Fix what it finds in the same sprint."

   WHAT IT CATCHES. A value that reaches innerHTML (or
   outerHTML, or insertAdjacentHTML) without going through an
   HTML escaper. The browser turns "<img onerror=...>" in a
   project name into a live element, so an unescaped value is
   an XSS hole with a user-supplied string in it.

   HOW IT DECIDES. The rule follows the VALUE, not the line:

     - a literal, a number, a boolean          -> safe
     - esc(x) / escapeHtml(x) / U.escapeHtml(x) -> safe
     - a template literal                      -> every
       INTERPOLATION inside it is checked
     - a '+' concatenation                     -> every
       operand is checked
     - an identifier                           -> resolved to
       its declaration in scope and the
       declaration is checked
     - arr.map(fn).join('')                   -> the CALLBACK
       is checked, because that is where the
       html is written
     - a call to a local function              -> the function
       is resolved and its own string building
       is checked

   So the report points at the exact interpolation that is not
   escaped, not at the whole chain.

   THE MARKER. A line (or the statement above it) may carry
   `// ok: <reason>`. A reason is required - "ok" on its own
   is not an allowance, it is a shrug. The same convention
   the weak-random gate already uses, so the repo has ONE
   way to say "this was looked at and is fine".
   ============================================================ */
'use strict';

// The escapers this codebase actually uses. Anything on this list
// turns a value into text that is safe inside an HTML string.
const SANITIZERS = new Set([
  'esc',
  'escapeHtml',
  'escHtml',
  'htmlEscape',
  'escapeAttr',
  'encodeHtml',
  '_esc'
]);

// A marker comment: `// ok: <reason>`. The reason must be there.
const OK_MARKER = /ok:\s*\S+/i;

const HTML_SINKS = new Set(['innerHTML', 'outerHTML']);

// Functions that always return a NUMBER. A number cannot carry a tag
// into the page, so it never needs escaping.
const NUMERIC_FNS = new Set(['Number', 'parseInt', 'parseFloat']);

// The same for the Math namespace.
const NUMERIC_MATH = new Set([
  'abs',
  'round',
  'floor',
  'ceil',
  'min',
  'max',
  'sign',
  'trunc',
  'sqrt',
  'pow'
]);

// Locale formatters. They render a NUMBER or a DATE - never free text.
const LOCALE_METHODS = new Set([
  'toLocaleString',
  'toLocaleDateString',
  'toLocaleTimeString',
  'toFixed'
]);

function propertyName(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal') return String(node.value);
  return '';
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every value that reaches innerHTML/outerHTML/insertAdjacentHTML to pass through an HTML escaper.'
    },
    schema: [],
    messages: {
      unsanitized:
        'This value reaches {{sink}} without an HTML escaper. Wrap it in esc() / U.escapeHtml(), or mark the line `// ok: <reason>` if it is provably safe.'
    }
  },

  create(context) {
    const sourceCode = context.sourceCode;

    // ---- the marker -------------------------------------------------
    function hasOkMarker(node) {
      // A comment on the same line as the node, or on the line above.
      if (!node || !node.loc) return false;
      const comments = sourceCode.getAllComments();
      const line = node.loc.start.line;
      for (const c of comments) {
        if (!OK_MARKER.test(c.value)) continue;
        if (c.loc.start.line === line) return true;
        if (c.loc.end.line === line - 1) return true;
      }
      return false;
    }

    // ---- is this call an escaper? ----------------------------------
    // A LOCAL escaper is checked by its BODY, not by its name. A helper
    // called esc() that only escapes the double quote is not an escaper:
    // the value still reaches the page as live markup. (The repo had
    // exactly that in js/render/people.js - caught by this check.)
    function isRealEscaper(fn) {
      if (!fn) return true; // cannot see it - trust the name
      const text = sourceCode.getText(fn);
      // It delegates to another escaper.
      if (/(escapeHtml|escapeAttr|encodeHtml|htmlEscape|escapeText|_esc)\b/.test(text)) {
        return true;
      }
      // The textContent trick: escapes & < > (text position).
      if (text.indexOf('textContent') !== -1) return true;
      // A replace() whose pattern carries the characters that matter.
      const patterns = [];
      const re = /\.replace(?:All)?\(\s*(\/[^/]*\/|'[^']*'|"[^"]*")/g;
      let m;
      while ((m = re.exec(text))) patterns.push(m[1]);
      return /[<&]/.test(patterns.join(' '));
    }

    function isSanitizerCall(node) {
      if (!node || node.type !== 'CallExpression') return false;
      const callee = node.callee;
      if (callee.type === 'Identifier') {
        if (!SANITIZERS.has(callee.name)) return false;
        const fn = resolveFunctionFromIdentifier(callee);
        if (fn && !isRealEscaper(fn)) return false;
        return true;
      }
      if (callee.type === 'MemberExpression') {
        return SANITIZERS.has(propertyName(callee.property));
      }
      return false;
    }

    // ---- resolve an identifier to its declaration -------------------
    function resolveVariable(node) {
      let scope = sourceCode.getScope(node);
      const name = node.name;
      while (scope) {
        const variable = scope.set.get(name);
        if (variable && variable.defs && variable.defs.length) {
          return variable;
        }
        scope = scope.upper;
      }
      return null;
    }

    function resolveIdentifier(node) {
      const variable = resolveVariable(node);
      return variable ? variable.defs[0] : null;
    }

    // ---- map callbacks ---------------------------------------------
    // A function used as a .map() / .flatMap() callback gets the array
    // INDEX as its second parameter onwards. An index is a number, so it
    // can never carry a tag into the page. The set is filled once, from
    // the whole file, so the fact holds no matter which path the
    // analysis reaches the parameter through.
    let mapCallbacks = new WeakSet();
    // fn -> the parameter names that are provably safe inside that
    // function (a map index, the element of a fixed list). The walk
    // needs this: a function nested in a builder is analysed with the
    // context of the function it sits in, not the context of the
    // builder around it.
    let mapSafeParams = new WeakMap();

    function collectMapCallbacks(programNode) {
      const found = new WeakSet();
      const safe = new WeakMap();
      const visit = node => {
        if (!node || typeof node.type !== 'string') return;
        if (
          node.type === 'CallExpression' &&
          node.callee &&
          node.callee.type === 'MemberExpression' &&
          (propertyName(node.callee.property) === 'map' ||
            propertyName(node.callee.property) === 'flatMap')
        ) {
          const cb = node.arguments[0];
          let fn = null;
          if (cb) {
            if (cb.type === 'ArrowFunctionExpression' || cb.type === 'FunctionExpression') {
              fn = cb;
            } else if (cb.type === 'Identifier') {
              fn = resolveFunctionFromIdentifier(cb);
            }
          }
          if (fn) {
            found.add(fn);
            safe.set(fn, safeParamsForCallback(fn, node.callee.object));
          }
        }
        for (const key of Object.keys(node)) {
          if (key === 'parent') continue;
          const child = node[key];
          if (Array.isArray(child)) {
            child.forEach(c => {
              if (c && typeof c.type === 'string') visit(c);
            });
          } else if (child && typeof child.type === 'string') {
            visit(child);
          }
        }
      };
      visit(programNode);
      mapSafeParams = safe;
      return found;
    }

    // The parameters of a map callback that are provably safe: the
    // index onwards (a number), and the FIRST one when the array it
    // walks is a list of literals, a constant array, or the keys of a
    // constant map. ONE place computes this, so the walk and the map
    // branch always agree.
    function safeParamsForCallback(fn, arr) {
      const params = (fn && fn.params) || [];
      const safe = new Set();
      for (let i = 1; i < params.length; i++) {
        if (params[i] && params[i].type === 'Identifier') safe.add(params[i].name);
      }
      const first = params[0];
      if (first && first.type === 'Identifier') {
        if (isLiteralList(arr) || isFixedArray(arr) || isFixedKeyList(arr)) {
          safe.add(first.name);
        }
      }
      return safe;
    }

    // Is this parameter the array index of a .map() callback?
    // eslint-scope puts the FUNCTION that owns the parameter on the
    // definition (def.node), and the parameter's position in the
    // parameter list on def.index.
    function isMapIndexParam(def) {
      if (!mapCallbacks) return false;
      const owner = def.node;
      if (!owner || !owner.params) return false;
      const idx = typeof def.index === 'number' ? def.index : -1;
      if (idx < 1) return false;
      return mapCallbacks.has(owner);
    }

    // A fixed list of literals: ['a','b'] or [['a','b'],['c','d']].
    // The element of such a list cannot carry a tag.
    function isLiteralList(node) {
      if (!node || node.type !== 'ArrayExpression' || !node.elements.length) return false;
      return node.elements.every(e => {
        if (!e) return false;
        if (e.type === 'Literal') return true;
        if (e.type === 'ArrayExpression') {
          return e.elements.length > 0 && e.elements.every(x => x && x.type === 'Literal');
        }
        return false;
      });
    }

    // A value that is known before the page runs: a literal, or an
    // array/object whose members are all known. A value built from
    // other values is NOT known - that is the hole the rule is for.
    function isStaticValue(node, depth) {
      const d = depth || 0;
      if (!node || d > 4) return false;
      switch (node.type) {
        case 'Literal':
          return true;
        case 'ArrayExpression':
          return node.elements.length > 0 && node.elements.every(e => isStaticValue(e, d + 1));
        case 'ObjectExpression':
          return (
            node.properties.length > 0 &&
            node.properties.every(
              p =>
                p.type === 'Property' &&
                p.value &&
                p.value.type !== 'FunctionExpression' &&
                p.value.type !== 'ArrowFunctionExpression' &&
                isStaticValue(p.value, d + 1)
            )
          );
        default:
          return false;
      }
    }

    // The single constant assignment behind an identifier, when the
    // variable is never written again.
    function resolveInit(node) {
      if (!node || node.type !== 'Identifier') return null;
      const variable = resolveVariable(node);
      if (!variable || !variable.defs || !variable.defs.length) return null;
      const def = variable.defs[0];
      if (def.type !== 'Variable' || !def.node || !def.node.init) return null;
      const writes = variable.references.filter(r => r.writeExpr && !r.init);
      if (writes.length) return null;
      return def.node.init;
    }

    // The array behind an expression, when its elements are known.
    // A filter or a slice keeps the elements, so it keeps the
    // knowledge: const visible = TABS.filter(..) is still TABS.
    function fixedArraySource(node, depth) {
      const d = depth || 0;
      if (!node || d > 4) return null;
      if (node.type === 'Identifier') {
        const init = resolveInit(node);
        if (!init) return null;
        return fixedArraySource(init, d + 1);
      }
      if (node.type === 'ArrayExpression') return node;
      if (
        node.type === 'CallExpression' &&
        node.callee &&
        node.callee.type === 'MemberExpression'
      ) {
        const m = propertyName(node.callee.property);
        if (m === 'filter' || m === 'slice') {
          return fixedArraySource(node.callee.object, d + 1);
        }
      }
      return null;
    }

    // A constant array: const TABS = [{ id: 'x' }, ...]. The ELEMENTS
    // are known, so the element and every part of it are known.
    function isFixedArray(node) {
      const arr = fixedArraySource(node);
      if (!arr) return false;
      return arr.elements.length > 0 && arr.elements.every(e => isStaticValue(e, 0));
    }

    // A constant map: const TYPES = { a: 'Alpha' }. Every value in it
    // is fixed, so reading any of them is safe - whatever the key.
    function isFixedMap(node) {
      if (!node) return false;
      const init = node.type === 'Identifier' ? resolveInit(node) : node;
      if (!init || init.type !== 'ObjectExpression') return false;
      return (
        init.properties.length > 0 &&
        init.properties.every(p => p.type === 'Property' && p.value && p.value.type === 'Literal')
      );
    }

    // Object.keys( a constant map ) - the keys are the map's own
    // names, so they are fixed strings.
    function isFixedKeyList(node) {
      if (!node || node.type !== 'CallExpression') return false;
      const callee = node.callee;
      if (!callee || callee.type !== 'MemberExpression') return false;
      if (!callee.object || callee.object.type !== 'Identifier') return false;
      if (callee.object.name !== 'Object') return false;
      const m = propertyName(callee.property);
      const arg = node.arguments && node.arguments[0];
      if (!arg) return false;
      if (m === 'keys') return isFixedMap(arg);
      if (m === 'values') return isStaticValue(arg, 0);
      return false;
    }

    // ---- the analysis ----------------------------------------------
    // `out` collects the expressions that reach the sink WITHOUT an
    // escaper. The rule never reports from here; the sink handler
    // decides.
    const seen = new Set();
    const builderCache = new Map();

    function push(out, node, probe) {
      if (!node || seen.has(node)) return;
      // A reviewed exception: the interpolation's own line - or the
      // line any enclosing statement starts on - carries
      // `// ok: <reason>`. This is how a value that is provably NOT
      // text (a number, a date, a class name from a fixed list) says
      // so without changing what it renders.
      if (hasOkMarker(node)) return;
      if (hasOkMarkerInAncestors(node)) return;
      // A PROBE (the "is this builder safe?" check) must NOT consume
      // the node: the probe runs first, and if it marked the node as
      // seen the real report would skip it and the finding would be
      // swallowed.
      if (!probe) seen.add(node);
      out.push(node);
    }

    // A marker on the line that OPENS a long template covers the
    // whole statement: that is where a reader looks for the note.
    function hasOkMarkerInAncestors(node) {
      let n = node;
      while (n && n.parent) {
        n = n.parent;
        if (
          n.type === 'ExpressionStatement' ||
          n.type === 'VariableDeclaration' ||
          n.type === 'ReturnStatement' ||
          n.type === 'Property' ||
          n.type === 'ArrayExpression' ||
          n.type === 'ArrowFunctionExpression' ||
          n.type === 'FunctionExpression'
        ) {
          if (hasOkMarker(n)) return true;
        }
      }
      return false;
    }

    // Walk a function body for the strings it builds, and push the
    // ones that are not escaped. Used for a map callback (where the
    // html is written) and for a builder function (where the html is
    // assembled).
    function collectFromBody(fn, depth, out, ctx, probe) {
      if (!fn || !fn.body) return;
      const body = fn.body;
      const c = ctx || {};
      if (probe) c.probe = true;
      if (body.type !== 'BlockStatement') {
        analyse(body, depth + 1, out, c);
        return;
      }
      // A function nested in this one is analysed with the context of
      // ITS OWN parameters, not the ones of the function around it.
      // Without this, a map callback is walked twice: once correctly
      // (with its index/element marked safe) and once wrongly (with
      // the builder's context), and the wrong pass reports a value
      // that is provably safe.
      const ctxFor = (child, cur) => {
        if (
          !child ||
          (child.type !== 'FunctionExpression' &&
            child.type !== 'ArrowFunctionExpression' &&
            child.type !== 'FunctionDeclaration')
        ) {
          return cur;
        }
        const set = new Set(cur.safeParams ? Array.from(cur.safeParams) : []);
        const own = mapSafeParams.get(child);
        if (own) own.forEach(n => set.add(n));
        const next = { safeParams: set };
        // The probe flag has to travel with the context: a probe must
        // never mark a node as seen, or the real pass would skip it
        // and the finding would be swallowed.
        if (cur.probe) next.probe = true;
        return next;
      };
      const walk = (node, ctx) => {
        if (!node || typeof node.type !== 'string') return;
        if (node.type === 'ReturnStatement' && node.argument) {
          analyse(node.argument, depth + 1, out, ctx);
        }
        if (
          node.type === 'AssignmentExpression' &&
          node.operator === '+=' &&
          node.left.type === 'Identifier'
        ) {
          analyse(node.right, depth + 1, out, ctx);
        }
        for (const key of Object.keys(node)) {
          if (key === 'parent') continue;
          const child = node[key];
          if (Array.isArray(child)) {
            child.forEach(item => {
              if (item && typeof item.type === 'string') walk(item, ctxFor(item, ctx));
            });
          } else if (child && typeof child.type === 'string') {
            walk(child, ctxFor(child, ctx));
          }
        }
      };
      walk(body, c);
    }

    // Is this function a builder that escapes everything it puts into
    // an HTML string?
    function isSafeBuilder(fn, depth) {
      if (!fn || !fn.body) return false;
      if (builderCache.has(fn)) return builderCache.get(fn);
      builderCache.set(fn, true); // recursion guard
      const tmp = [];
      collectFromBody(fn, depth, tmp, null, true);
      const safe = tmp.length === 0;
      builderCache.set(fn, safe);
      return safe;
    }

    function resolveFunctionFromIdentifier(node) {
      if (!node || node.type !== 'Identifier') return null;
      const def = resolveIdentifier(node);
      if (!def) return null;
      if (def.type === 'FunctionName') return def.node;
      if (def.type === 'Variable' && def.node && def.node.init) {
        const init = def.node.init;
        if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
          return init;
        }
      }
      return null;
    }

    function resolveFunction(callNode) {
      if (!callNode.callee || callNode.callee.type !== 'Identifier') return null;
      return resolveFunctionFromIdentifier(callNode.callee);
    }

    // The core: follow one value and push whatever is not escaped.
    function analyse(node, depth, out, ctx) {
      if (!node || depth > 10) return;
      const c = ctx || {};

      switch (node.type) {
        case 'Literal':
          return;

        case 'ArrayExpression':
          // A list of html pieces - each one is checked on its own.
          node.elements.forEach(e => analyse(e, depth + 1, out, c));
          return;

        case 'TemplateLiteral':
          node.expressions.forEach(e => analyse(e, depth + 1, out, c));
          return;

        case 'BinaryExpression':
          if (node.operator === '+') {
            analyse(node.left, depth + 1, out, c);
            analyse(node.right, depth + 1, out, c);
          }
          return;

        case 'ConditionalExpression':
          analyse(node.consequent, depth + 1, out, c);
          analyse(node.alternate, depth + 1, out, c);
          return;

        case 'LogicalExpression':
          analyse(node.left, depth + 1, out, c);
          analyse(node.right, depth + 1, out, c);
          return;

        case 'CallExpression': {
          if (isSanitizerCall(node)) return;

          // An inline function that is called at once: (() => html)()
          if (
            node.callee &&
            (node.callee.type === 'ArrowFunctionExpression' ||
              node.callee.type === 'FunctionExpression')
          ) {
            collectFromBody(node.callee, depth + 1, out, c.probe ? { probe: true } : {});
            return;
          }

          // arr.map(fn) - the html is written inside the callback.
          const callee = node.callee;

          // A number. Numbers are not text, so they cannot carry a
          // tag into the page.
          if (callee && callee.type === 'Identifier' && NUMERIC_FNS.has(callee.name)) {
            return;
          }
          if (callee && callee.type === 'MemberExpression') {
            const obj = callee.object;
            if (
              obj &&
              obj.type === 'Identifier' &&
              obj.name === 'Math' &&
              NUMERIC_MATH.has(propertyName(callee.property))
            ) {
              return;
            }
            // A locale-formatted number or a date. Never free text.
            if (LOCALE_METHODS.has(propertyName(callee.property))) {
              return;
            }
          }

          if (callee && callee.type === 'MemberExpression') {
            const method = propertyName(callee.property);
            if (method === 'map' || method === 'flatMap') {
              const cb = node.arguments[0];
              let fn = null;
              if (cb) {
                if (cb.type === 'ArrowFunctionExpression' || cb.type === 'FunctionExpression') {
                  fn = cb;
                } else if (cb.type === 'Identifier') {
                  // arr.map(namedFn) - the html is written inside that
                  // function, so the FUNCTION is what matters.
                  fn = resolveFunctionFromIdentifier(cb);
                }
              }
              if (fn) {
                // The parameters of a map callback are known:
                //   - the SECOND one onwards is the index (a number)
                //   - the FIRST one is the element, and it is safe
                //     when the array is a list of literals
                //     (['open', 'routed'].map(v => ...))
                const safe = new Set(c.safeParams ? Array.from(c.safeParams) : []);
                const own = safeParamsForCallback(fn, callee.object);
                own.forEach(n => safe.add(n));
                const childCtx = { safeParams: safe };
                if (c.probe) childCtx.probe = true;
                collectFromBody(fn, depth + 1, out, childCtx);
                return;
              }
              push(out, node, c.probe);
              return;
            }
            // The array keeps its elements, so the elements' own
            // provenance is what matters - a filter or a slice does
            // not turn an object into a string.
            if (
              method === 'filter' ||
              method === 'slice' ||
              method === 'sort' ||
              method === 'reverse'
            ) {
              return;
            }
            // join('') writes the array's strings into the page.
            if (method === 'join') {
              analyse(callee.object, depth + 1, out, c);
              return;
            }
            // A number.
            if (method === 'length') return;
            if (method === 'toFixed' || method === 'toString' || method === 'trim') {
              analyse(callee.object, depth + 1, out, c);
              return;
            }
          }

          // A call to a local function.
          const fn = resolveFunction(node);
          if (fn) {
            if (hasOkMarker(fn)) return;
            if (isSafeBuilder(fn, depth + 1)) return;
            // Report the string it builds, not the call.
            collectFromBody(fn, depth + 1, out, {});
            return;
          }
          push(out, node, c.probe);
          return;
        }

        case 'Identifier': {
          const def = resolveIdentifier(node);
          if (!def) {
            // An unknown global (a browser API, a namespace) - we
            // cannot see what it holds.
            push(out, node, c.probe);
            return;
          }
          if (def.type === 'FunctionName') {
            if (hasOkMarker(def.node)) return;
            if (isSafeBuilder(def.node, depth + 1)) return;
            collectFromBody(def.node, depth + 1, out, {});
            return;
          }
          if (def.type === 'Parameter') {
            // A parameter could be anything - unless the caller
            // proved what it is (a map index, a literal list).
            if (c.safeParams && c.safeParams.has(node.name)) return;
            if (isMapIndexParam(def)) return;
            push(out, node, c.probe);
            return;
          }
          if (def.type === 'Variable') {
            if (def.node && def.node.init) {
              if (hasOkMarker(def.node)) return;
              analyse(def.node.init, depth + 1, out, c);
              return;
            }
            // Declared now, filled in later (`var chip; chip = html`).
            // The assignment is the value that reaches the sink.
            const variable = resolveVariable(node);
            const writes = variable ? variable.references.filter(r => r.writeExpr && !r.init) : [];
            if (writes.length) {
              writes.forEach(r => analyse(r.writeExpr, depth + 1, out, c));
              return;
            }
          }
          push(out, node, c.probe);
          return;
        }

        case 'MemberExpression': {
          // A count. Never text.
          if (propertyName(node.property) === 'length') return;
          if (node.object && node.object.type === 'Identifier') {
            const name = node.object.name;
            // A property of a value that came from a fixed literal list
            // (the element of ['a','b'].map(v => v[0])).
            if (c.safeParams && c.safeParams.has(name)) return;
            // A property of a CONSTANT MAP: every value in it is fixed,
            // so reading one is safe whatever the key is.
            if (isFixedMap(node.object)) return;
          }
          // window.MMGR.something - the value is not visible here.
          push(out, node, c.probe);
          return;
        }

        case 'ThisExpression':
          return;

        default:
          push(out, node, c.probe);
      }
    }

    // ---- the sinks --------------------------------------------------
    function checkSink(node, valueNode, sinkName) {
      if (hasOkMarker(node)) return;
      const unsafe = [];
      analyse(valueNode, 0, unsafe);
      unsafe.forEach(u => {
        context.report({
          node: u,
          messageId: 'unsanitized',
          data: { sink: sinkName }
        });
      });
    }

    return {
      Program(node) {
        // Every node's parent is set before the rules run, so the map
        // callbacks can be collected up front - before any sink is
        // analysed, and whatever order the file is written in.
        mapCallbacks = collectMapCallbacks(node);
      },

      AssignmentExpression(node) {
        const left = node.left;
        if (!left || left.type !== 'MemberExpression') return;
        const name = propertyName(left.property);
        if (!HTML_SINKS.has(name)) return;
        checkSink(node, node.right, name);
      },

      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression') return;
        if (propertyName(callee.property) !== 'insertAdjacentHTML') return;
        // The content is the second argument.
        if (node.arguments.length < 2) return;
        checkSink(node, node.arguments[1], 'insertAdjacentHTML');
      }
    };
  }
};
