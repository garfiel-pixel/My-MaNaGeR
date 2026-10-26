#!/usr/bin/env node
/* ============================================================
   tools/sweep/sweep.cjs - THE SWEEP (REFINEMENT-DIRECTIVE-2026-10-24, section 11)
   ------------------------------------------------------------
   The owner asked for every sibling of the bugs the directive
   named, not only the ones it named. This is that search: fourteen
   READ-ONLY detectors, each one answering the question in the
   directive's own table row, printing counts and `file:line` so a
   finding can be opened without re-running the sweep.

   It writes nothing except the report (with --write), starts no
   server, launches no browser, and touches no state. That is the
   contract: a sweep that can change the tree is not a sweep.

   Usage:
     node tools/sweep/sweep.cjs              # print the report
     node tools/sweep/sweep.cjs --id=sw-3    # one detector
     node tools/sweep/sweep.cjs --write      # write docs/SWEEP-2026-10.md

   Registry: docs/CI-TEST-COVERAGE.md -> MANUAL row (a report, not a
   pass/fail gate). Detectors that reach zero hits become permanent
   gates in the wave that owns the area; the row that says so is the
   "Fix lands in" column of the directive's table.

   WHY ONE ENGINE AND NOT FOURTEEN SCRIPTS: every detector needs the
   same walk, the same served-file list and the same line resolver.
   Fourteen copies of that would drift the moment a page is added, and
   a sweep that silently scans the wrong files is worse than none.
   Each detector is a named function below, keyed by its SW id.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const ONLY = (args.find(a => a.indexOf('--id=') === 0) || '').slice(5);
const WRITE = args.indexOf('--write') > -1;
const OUT = path.join(ROOT, 'docs', 'SWEEP-2026-10.md');

// ---- file lists -----------------------------------------------------------
const isPage = f => /\.html$/i.test(f) && !/ /.test(f); // serve-able pages only
const readdir = (dir, filter) => {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) {
    return [];
  }
  return fs
    .readdirSync(abs)
    .filter(filter)
    .map(f => (dir === '.' ? f : dir + '/' + f));
};
const PAGES = readdir('.', isPage);
const JS = readdir('js', f => f.endsWith('.js'));
const CSS = readdir('css', f => f.endsWith('.css'));
const SRC = readdir('src', f => f.endsWith('.js')).concat(
  readdir('src/lib', f => f.endsWith('.js')),
  readdir('src/cloud', f => f.endsWith('.js')),
  readdir('src/auth', f => f.endsWith('.js'))
);
const SCANNED = PAGES.concat(JS, CSS, SRC, ['worker.js']);

const cache = new Map();
function text(rel) {
  if (!cache.has(rel)) {
    let t = '';
    try {
      t = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    } catch (e) {
      t = '';
    }
    cache.set(rel, t);
  }
  return cache.get(rel);
}
// A hit is { file, line, note }. `line` is resolved lazily from an index so the
// report can be opened at the finding.
function lineAt(rel, index) {
  return text(rel).slice(0, index).split('\n').length;
}
// CSS comments are prose, not selectors. Replacing each comment with spaces of
// the SAME length keeps every offset (and therefore every line number) valid,
// so a detector never reports a comment as a rule.
function cssText(rel) {
  return text(rel).replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
}
// A detector should never count its own documentation. Used by the JS scans.
function codeLine(rel, line) {
  const l = (text(rel).split('\n')[line - 1] || '').trim();
  return !(l.indexOf('//') === 0 || l.indexOf('*') === 0 || l.indexOf('/*') === 0);
}
function eachMatch(rel, re, fn) {
  const src = text(rel);
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(src))) {
    fn(m, lineAt(rel, m.index), src);
  }
}

// ---- the fourteen detectors ----------------------------------------------
// Every detector returns { id, title, fix, hits: [{file, line, note}] }.
const DETECTORS = [];

// SW-1 - trades whose matDesc lists several parts but have no ACCESSORIES entry.
DETECTORS.push(() => {
  const rel = 'js/calculator-page.js';
  const src = text(rel);
  const hits = [];
  const start = src.indexOf('const WORK = {');
  const end = src.indexOf('\n  };', start);
  const hasAccessories = /const ACCESSORIES\s*=/.test(src);
  const body = start > -1 && end > start ? src.slice(start, end) : '';
  const re = /^    ([A-Za-z][A-Za-z0-9-]*): \{/gm;
  let m;
  const keys = [];
  while ((m = re.exec(body))) {
    keys.push({ key: m[1], at: start + m.index });
  }
  keys.forEach((k, i) => {
    const chunk = body.slice(i === 0 ? 0 : keys[i - 1].at - start, k.at - start + 900);
    const md = /matDesc:\s*'([^']*)'/.exec(chunk.slice(chunk.indexOf(k.key)));
    if (!md) {
      return;
    }
    const parts = md[1]
      .split(/,|&|\+|\band\b/)
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length < 2) {
      return;
    }
    if (hasAccessories) {
      return;
    }
    hits.push({
      file: rel,
      line: lineAt(rel, k.at),
      note: k.key + ': ' + parts.length + ' parts in matDesc ("' + md[1] + '")'
    });
  });
  return {
    id: 'SW-1',
    title: 'trades whose matDesc lists several parts but have no ACCESSORIES entry',
    fix: 'Wave E (MAT-1)',
    hits
  };
});

// SW-2 - dialogs with a data-action container that hold inputs.
DETECTORS.push(() => {
  const hits = [];
  PAGES.forEach(rel => {
    const src = text(rel);
    const marks = [];
    const re = /<div[^>]*\bid="[^"]*"[^>]*data-action="[A-Za-z]*Bg"[^>]*>/g;
    eachMatch(rel, re, (m, line) => {
      marks.push({ at: m.index, line, tag: m[0] });
    });
    marks.forEach((mk, i) => {
      const next = i + 1 < marks.length ? marks[i + 1].at : src.length;
      const chunk = src.slice(mk.at, next);
      const inputs = (chunk.match(/<input\b/g) || []).length;
      if (!inputs) {
        return;
      }
      const id = (/id="([^"]*)"/.exec(mk.tag) || [])[1] || '(no id)';
      hits.push({
        file: rel,
        line: mk.line,
        note: id + ' holds ' + inputs + ' input(s) behind a container click handler'
      });
    });
  });
  return {
    id: 'SW-2',
    title: 'dialogs with a data-action container that hold inputs',
    fix: 'Wave D (APP-4 - fixed; this list is now the regression surface)',
    hits
  };
});

// SW-3 - every select / option / optgroup / popup-list colour pair, per theme.
DETECTORS.push(() => {
  const hits = [];
  CSS.forEach(rel => {
    const src = cssText(rel);
    const rules = [];
    const re = /([^{}\n][^{}]*)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(src))) {
      const sel = m[1].trim();
      const body = m[2];
      if (!/(^|[\s,>])(option|optgroup)\b/.test(sel) && !/select\b/.test(sel)) {
        continue;
      }
      if (!/(^|[\s;(])color\s*:|background/.test(body)) {
        continue;
      }
      rules.push({ sel, line: lineAt(rel, m.index), body });
    }
    const dark = rules.filter(r => /dark-mode|data-theme/.test(r.sel));
    const light = rules.filter(r => !/dark-mode|data-theme/.test(r.sel));
    light.forEach(r => {
      hits.push({
        file: rel,
        line: r.line,
        note:
          r.sel.replace(/\s+/g, ' ').slice(0, 90) +
          (dark.length ? ' (dark override present)' : ' (NO dark override in this file)')
      });
    });
  });
  return {
    id: 'SW-3',
    title: 'every select/option/optgroup colour pair, and whether a dark rule exists',
    fix: 'Wave D (UI-1)',
    hits
  };
});

// SW-4 - bare checkbox/radio outside a .tgl switch or a .set-row.
DETECTORS.push(() => {
  const hits = [];
  PAGES.forEach(rel => {
    eachMatch(rel, /<input\b[^>]*type="(?:checkbox|radio)"[^>]*>/g, (m, line) => {
      const before = text(rel).slice(Math.max(0, m.index - 260), m.index);
      const inside = /class="[^"]*\btgl\b/.test(before) || /class="[^"]*\bset-row\b/.test(before);
      if (!inside) {
        const id = (/id="([^"]*)"/.exec(m[0]) || [])[1] || '(no id)';
        hits.push({ file: rel, line, note: 'bare ' + m[0].slice(0, 60) + ' ... ' + id });
      }
    });
  });
  return {
    id: 'SW-4',
    title: 'bare checkbox/radio outside .tgl or .set-row',
    fix: 'Wave D (UI-2)',
    hits
  };
});

// SW-5 - position:fixed elements, and whether the page reserves space for them.
DETECTORS.push(() => {
  const hits = [];
  CSS.forEach(rel => {
    const src = cssText(rel);
    const re = /([^{}\n][^{}]*)\{([^{}]*position:\s*fixed[^{}]*)\}/g;
    let m;
    while ((m = re.exec(src))) {
      const sel = m[1].trim().replace(/\s+/g, ' ');
      const body = m[2];
      const reserves =
        /padding-(left|top|right|bottom)\s*:/.test(body) ||
        /margin-(left|top|right|bottom)\s*:/.test(body) ||
        /left:\s*(8|12|16|24)px/.test(body);
      hits.push({
        file: rel,
        line: lineAt(rel, m.index),
        note: sel.slice(0, 80) + (reserves ? ' (own offset only)' : ' (no space reserved)')
      });
    }
  });
  return {
    id: 'SW-5',
    title: 'position:fixed overlays and whether the page reserves space',
    fix: 'Wave D (APP-1)',
    hits
  };
});

// SW-6 - target=_blank / window.open pointing at an INTERNAL page.
DETECTORS.push(() => {
  const hits = [];
  const isInternal = u =>
    /^(?!https?:|mailto:|tel:|#)/.test(u) || /mymanagerworkspace\.com/i.test(u) === false
      ? /^(?!https?:|mailto:|tel:|#)/.test(u)
      : false;
  PAGES.concat(JS).forEach(rel => {
    eachMatch(rel, /target="_blank"/g, (m, line) => {
      const tag = text(rel).slice(Math.max(0, m.index - 400), m.index + 40);
      const href =
        (/href="([^"]*)"/g,
        tag.match(/href="([^"]*)"[^>]*target="_blank"|target="_blank"[^>]*href="([^"]*)"/));
      const u = href ? href[1] || href[2] || '' : '';
      if (isInternal(u)) {
        hits.push({ file: rel, line, note: 'target=_blank -> ' + u });
      }
    });
    eachMatch(rel, /window\.open\(\s*([^)]{0,120})\)/g, (m, line) => {
      const arg = m[1];
      const internal =
        /['"]\/?[a-z0-9-]+\.html['"]|['"]\/?(app|project|admin|calculator)['"]$/i.test(arg) ||
        /'(app|project|admin|calculator)\.html/.test(arg);
      if (internal) {
        hits.push({ file: rel, line, note: 'window.open(' + arg.slice(0, 70) + ')' });
      }
    });
  });
  return {
    id: 'SW-6',
    title: 'target=_blank and window.open on internal pages',
    fix: 'Wave D (APP-2)',
    hits
  };
});

// SW-7 - pages that load a shader / three / globe / backdrop-filter without the
// performance boot.
DETECTORS.push(() => {
  const hits = [];
  PAGES.forEach(rel => {
    const src = text(rel);
    const heavy = /marketing-globe\.js|mmgr-glass\.js|backdrop-filter|three(\.min)?\.js/i.test(src);
    if (!heavy) {
      return;
    }
    const boot = /mmgr-perf-boot\.js/.test(src);
    if (!boot) {
      hits.push({
        file: rel,
        line: 1,
        note: 'loads globe/glass/backdrop-filter with NO perf boot script'
      });
    }
  });
  return {
    id: 'SW-7',
    title: 'pages with a shader, globe or backdrop-filter and no Perf boot',
    fix: 'Wave D (PERF-1)',
    hits
  };
});

// SW-8 - hard-coded colours inside component rules instead of tokens.
DETECTORS.push(() => {
  const hits = [];
  CSS.forEach(rel => {
    const src = cssText(rel);
    const re = /([^{}\n][^{}]*)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(src))) {
      const sel = m[1].trim();
      if (
        !sel ||
        /^:root|^html|^\*/.test(sel) ||
        (/--[a-z-]+\s*:/.test(m[2]) && !/color\s*:/.test(m[2]))
      ) {
        continue;
      }
      const body = m[2];
      const hex = body.match(/#[0-9a-f]{3,8}\b/gi) || [];
      const rgb = body.match(/rgba?\([^)]*\)/gi) || [];
      const literals = hex.concat(rgb).filter(v => !/var\(/.test(v));
      if (!literals.length) {
        continue;
      }
      hits.push({
        file: rel,
        line: lineAt(rel, m.index),
        note: sel.replace(/\s+/g, ' ').slice(0, 70) + ' -> ' + literals.slice(0, 3).join(' ')
      });
    }
  });
  return {
    id: 'SW-8',
    title: 'hard-coded colours inside component rules instead of tokens',
    fix: 'Wave E (GOLD-1)',
    hits
  };
});

// SW-9 - text below 0.78rem, and <small> blocks over 140 characters.
DETECTORS.push(() => {
  const hits = [];
  CSS.forEach(rel => {
    eachMatch(rel, /font-size:\s*(0?\.\d+|\d+)rem/g, (m, line) => {
      if (!codeLine(rel, line)) {
        return;
      }
      const n = parseFloat(m[1]);
      if (n < 0.78) {
        hits.push({ file: rel, line, note: 'font-size ' + m[1] + 'rem' });
      }
    });
  });
  PAGES.forEach(rel => {
    const src = text(rel);
    const re = /<small\b[^>]*>([\s\S]{0,400}?)<\/small>/g;
    let m;
    while ((m = re.exec(src))) {
      const words = m[1]
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (words.length > 140) {
        hits.push({
          file: rel,
          line: lineAt(rel, m.index),
          note: '<small> holds ' + words.length + ' characters'
        });
      }
    }
  });
  return {
    id: 'SW-9',
    title: 'text under 0.78rem and <small> blocks over 140 characters',
    fix: 'Wave D (UI-3) and a pass per page',
    hits
  };
});

// SW-10 - clickable div/span with no role, tabindex or key handler.
DETECTORS.push(() => {
  const hits = [];
  PAGES.forEach(rel => {
    eachMatch(rel, /<(div|span|li|td)\b[^>]*data-action="[^"]*"[^>]*>/g, (m, line) => {
      const tag = m[0];
      if (/role=|tabindex=/.test(tag)) {
        return;
      }
      hits.push({
        file: rel,
        line,
        note: m[1] + ' data-action=' + (/data-action="([^"]*)"/.exec(tag) || [])[1]
      });
    });
  });
  return {
    id: 'SW-10',
    title: 'clickable div/span with no role, tabindex or key handler',
    fix: 'Wave F',
    hits
  };
});

// SW-11 - numeric inputs with no inputmode on the app and project pages.
DETECTORS.push(() => {
  const hits = [];
  ['app.html', 'project.html', 'calculator.html', 'admin.html'].forEach(rel => {
    if (!fs.existsSync(path.join(ROOT, rel))) {
      return;
    }
    eachMatch(rel, /<input\b[^>]*>/g, (m, line) => {
      const tag = m[0];
      const numeric =
        /type="number"/.test(tag) || /\bstep=/.test(tag) || /inputmode="decimal"/.test(tag);
      if (!numeric) {
        return;
      }
      if (/inputmode=/.test(tag)) {
        return;
      }
      const id = (/id="([^"]*)"/.exec(tag) || [])[1] || '(no id)';
      hits.push({ file: rel, line, note: id + ' is numeric with no inputmode' });
    });
  });
  return {
    id: 'SW-11',
    title: 'numeric inputs with no inputmode',
    fix: 'Wave D',
    hits
  };
});

// SW-12 - money literals typed into strings instead of read from the table.
DETECTORS.push(() => {
  const hits = [];
  JS.forEach(rel => {
    eachMatch(rel, /(['"`])[^'"`\n]{0,40}(J\$|\$)\s?\d[^'"`\n]{0,40}\1/g, (m, line) => {
      const s = m[0];
      if (/^\s*['"]?\$['"]?$/.test(s)) {
        return;
      }
      if (!codeLine(rel, line)) {
        return;
      }
      hits.push({ file: rel, line, note: s.slice(0, 70) });
    });
  });
  return {
    id: 'SW-12',
    title: 'money literals typed into strings instead of the currency table',
    fix: 'Wave E',
    hits
  };
});

// SW-13 - notices that exist as a dashboard card but have no watcher.
DETECTORS.push(() => {
  const hits = [];
  const watch = text('js/mmgr-watch.js');
  PAGES.forEach(rel => {
    eachMatch(rel, /id="([a-z0-9-]*(?:notice|alert|expiry|risk)[a-z0-9-]*)"/gi, (m, line) => {
      const id = m[1];
      if (/^panel-/.test(id)) {
        return; // a panel is a region, not a notice
      }
      const key = id.replace(/-(card|box|list|wrap)$/, '');
      if (watch.indexOf(key) > -1 || watch.indexOf(id) > -1) {
        return;
      }
      hits.push({ file: rel, line, note: id + ' has no watch-module producer' });
    });
  });
  return {
    id: 'SW-13',
    title: 'notices that exist as a card but have no watcher',
    fix: 'Wave D (EXP-1, RISK-1)',
    hits
  };
});

// SW-14 - settings stored in state with no UI or AI path to set them.
DETECTORS.push(() => {
  const hits = [];
  const state = text('js/mmgr-state.js');
  const start = state.indexOf('settings: {');
  const end = state.indexOf('\n    },', start);
  if (start < 0) {
    return { id: 'SW-14', title: 'unreachable settings', fix: 'Wave E (AI-3)', hits: [] };
  }
  const block = state.slice(start, end > start ? end : start + 4000);
  const keys = [];
  const re = /^\s{6}([A-Za-z][A-Za-z0-9]*):/gm;
  let m;
  while ((m = re.exec(block))) {
    keys.push({ key: m[1], at: start + m.index });
  }
  const ui = PAGES.map(p => text(p)).join('\n');
  const ai = text('js/mmgr-ai.js') + text('js/calc-ai.js') + text('js/mmgr-settings.js');
  keys.forEach(k => {
    const inUi = ui.indexOf('calc-' + k) > -1 || ui.indexOf('set-' + k) > -1;
    const inAi = ai.indexOf('"' + k + '"') > -1 || ai.indexOf("'" + k + "'") > -1;
    if (!inUi && !inAi) {
      hits.push({ file: 'js/mmgr-state.js', line: lineAt('js/mmgr-state.js', k.at), note: k.key });
    }
  });
  return {
    id: 'SW-14',
    title: 'settings stored in state with no UI or AI path to set them',
    fix: 'Wave E (AI-3)',
    hits
  };
});

// ---- run ------------------------------------------------------------------
const results = DETECTORS.map(fn => fn()).filter(r => !ONLY || r.id.toLowerCase() === ONLY);

if (WRITE) {
  const lines = [];
  lines.push('# THE SWEEP - sibling audit, October 2026');
  lines.push('');
  lines.push(
    'Generated by `node tools/sweep/sweep.cjs --write` from ' +
      '`REFINEMENT-DIRECTIVE-2026-10-24.md` section 11. Read-only: the sweep ' +
      'starts nothing and changes nothing. Counts and `file:line` only, so a ' +
      'finding can be opened directly.'
  );
  lines.push('');
  lines.push('Scanned: ' + PAGES.length + ' served pages, ' + JS.length + ' `js/` modules, ');
  lines.push(CSS.length + ' stylesheets, ' + SRC.length + ' Worker modules and `worker.js`.');
  lines.push('');
  lines.push('| ID | Hits | Question | Fix lands in |');
  lines.push('|---|---|---|---|');
  results.forEach(r => {
    lines.push('| ' + r.id + ' | ' + r.hits.length + ' | ' + r.title + ' | ' + r.fix + ' |');
  });
  results.forEach(r => {
    lines.push('');
    lines.push('## ' + r.id + ' - ' + r.title);
    lines.push('');
    lines.push('**Hits: ' + r.hits.length + '** - fix lands in ' + r.fix + '.');
    if (!r.hits.length) {
      lines.push('');
      lines.push(
        'Zero hits. This detector becomes a permanent test in the wave that owns the area.'
      );
      return;
    }
    lines.push('');
    lines.push('| Where | What |');
    lines.push('|---|---|');
    r.hits.slice(0, 200).forEach(h => {
      lines.push(
        '| `' + h.file + ':' + h.line + '` | ' + String(h.note).replace(/\|/g, '\\|') + ' |'
      );
    });
    if (r.hits.length > 200) {
      lines.push('| ... | ' + (r.hits.length - 200) + ' more |');
    }
  });
  lines.push('');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n'));
  process.stdout.write('[sweep] wrote docs/SWEEP-2026-10.md\n');
}

const width = String(results.length).length;
results.forEach((r, i) => {
  process.stdout.write(
    '[sweep] ' +
      r.id +
      '  ' +
      String(r.hits.length).padStart(4) +
      '  ' +
      r.title +
      (r.hits.length ? '' : '  (clean)') +
      '\n'
  );
  r.hits.slice(0, 6).forEach(h => {
    process.stdout.write('          ' + h.file + ':' + h.line + '  ' + h.note + '\n');
  });
  if (r.hits.length > 6) {
    process.stdout.write('          ... ' + (r.hits.length - 6) + ' more\n');
  }
});
process.stdout.write(
  '[sweep] ' +
    results.reduce((n, r) => n + r.hits.length, 0) +
    ' findings across ' +
    results.length +
    ' sweeps\n'
);
