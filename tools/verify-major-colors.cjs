#!/usr/bin/env node
/* ============================================================
   tools/verify-major-colors.cjs - the eight chart slots hold up
   ------------------------------------------------------------
   UX-2026-11-19 B2. The dashboard ring and the "What is driving
   completion" list paint each major group with one of eight
   tokens, --major-1 .. --major-8, plus a neutral --major-other.

   These are NON-TEXT graphics on a CARD, so the floor is 3:1
   against that card - not 4.5:1. The card changes with the theme
   (white, parchment, near-black), so the same eight names are
   re-pointed in dark mode and in the three skins whose card is not
   the light default.

   ARMS
     1. the eight names + Other exist in the light set and in the
        dark set;
     2. every value used is a colour the app already ships somewhere
        else (no new hue) - the check strips the token declarations
        themselves before searching;
     3. for EVERY theme (light, dark, and each skin) all nine values
        clear 3:1 against that theme's own --card;
     4. the three non-default skins really do override the set, so
        arm 3 is not passing by inheriting a value that cannot work
        there.

   Usage: node tools/verify-major-colors.cjs
   Registry: docs/CI-TEST-COVERAGE.md
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'css', 'src');
const NAMES = [
  '--major-1',
  '--major-2',
  '--major-3',
  '--major-4',
  '--major-5',
  '--major-6',
  '--major-7',
  '--major-8',
  '--major-other'
];

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log('  PASS  ' + name);
  } else {
    failed++;
    console.log(
      '  FAIL  ' + name + '  <-- ' + JSON.stringify(detail === undefined ? null : detail)
    );
  }
}

/* ---- colour maths (WCAG 2.x) ---- */
function srgb(c) {
  c = c / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function lum(rgb) {
  return 0.2126 * srgb(rgb[0]) + 0.7152 * srgb(rgb[1]) + 0.0722 * srgb(rgb[2]);
}
function ratio(a, b) {
  const l1 = lum(a);
  const l2 = lum(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
function parseHex(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16)
  ];
}
function parseColor(v) {
  if (!v) {
    return null;
  }
  const hex = v.match(/#([0-9a-fA-F]{3,8})/);
  if (hex) {
    return { rgb: parseHex(hex[1]), alpha: 1 };
  }
  const rgb = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?/);
  if (rgb) {
    return {
      rgb: [parseInt(rgb[1]), parseInt(rgb[2]), parseInt(rgb[3])],
      alpha: rgb[4] === undefined ? 1 : parseFloat(rgb[4])
    };
  }
  return null;
}
function over(fg, bg) {
  const a = fg.alpha;
  return [
    Math.round(fg.rgb[0] * a + bg[0] * (1 - a)),
    Math.round(fg.rgb[1] * a + bg[1] * (1 - a)),
    Math.round(fg.rgb[2] * a + bg[2] * (1 - a))
  ];
}

/* ---- css reading ---- */
// 10-tokens.css carries TWO :root blocks (the neutral literals first, the
// palette second), so a plain indexOf finds the wrong one. `mustInclude`
// picks the block that actually declares what we came for.
function block(source, selector, mustInclude) {
  let i = source.indexOf(selector);
  while (i >= 0 && mustInclude) {
    const close = source.indexOf('}', i);
    if (source.slice(i, close).indexOf(mustInclude) !== -1) {
      break;
    }
    i = source.indexOf(selector, close);
  }
  if (i < 0) {
    return '';
  }
  if (i < 0) {
    return '';
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') {
      depth++;
    } else if (source[j] === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(open + 1, j);
      }
    }
  }
  return '';
}
function decls(text) {
  const out = {};
  (text.match(/--[a-zA-Z0-9-]+\s*:\s*[^;]+/g) || []).forEach(function (d) {
    const m = d.match(/--([a-zA-Z0-9-]+)\s*:\s*(.+)/);
    if (m) {
      out['--' + m[1]] = m[2].trim();
    }
  });
  return out;
}

const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const tokensCss = read('10-tokens.css');
const shellCss = read('20-shell.css');

const light = decls(block(tokensCss, ':root', '--major-1'));
const dark = decls(block(shellCss, 'body.dark-mode', '--major-1'));

// The skins: their selector block is `body.db-page[data-skin='<slug>']`.
const SKINS = [
  'bento',
  'departure',
  'editorial',
  'guild',
  'obsidian',
  'pegboard',
  'permit',
  'vellum'
];
const skinData = {};
SKINS.forEach(function (slug) {
  const file = '86-theme-' + slug + '.css';
  const src = read(file);
  const body = block(src, "[data-skin='" + slug + "']");
  skinData[slug] = decls(body);
});

console.log('MAJOR CHART COLOURS\n');

/* ---- arm 1: both sets declare all nine ---- */
const missingLight = NAMES.filter(n => !parseColor(light[n]));
const missingDark = NAMES.filter(n => !parseColor(dark[n]));
check('the light set declares all eight slots and Other', missingLight.length === 0, missingLight);
check('the dark set declares all eight slots and Other', missingDark.length === 0, missingDark);

/* ---- arm 2: no new hue ---- */
const tokenLines = new Set();
[tokensCss, shellCss, ...SKINS.map(s => read('86-theme-' + s + '.css'))].forEach(function (src) {
  src.split(/\r?\n/).forEach(function (line) {
    if (/--major-/.test(line)) {
      tokenLines.add(line.trim());
    }
  });
});
const corpus = fs
  .readdirSync(SRC)
  .filter(f => f.endsWith('.css') && f !== 'README.md')
  .map(f => read(f))
  .join('\n')
  .split(/\r?\n/)
  .filter(line => !/--major-/.test(line))
  .join('\n');

const usedValues = new Set();
[light, dark, ...Object.values(skinData)].forEach(function (set) {
  NAMES.forEach(function (n) {
    const c = parseColor(set[n]);
    if (c) {
      usedValues.add('#' + c.rgb.map(v => v.toString(16).padStart(2, '0')).join(''));
    }
  });
});
const invented = Array.from(usedValues).filter(function (hex) {
  const re = new RegExp(hex, 'i');
  return !re.test(corpus);
});
check(
  'every slot colour already ships elsewhere in the palette (no new hue)',
  invented.length === 0,
  invented
);

/* ---- arm 3: contrast in every theme ---- */
function cardRgbOf(raw, canvasRaw) {
  const c = parseColor(raw);
  if (!c) {
    return [255, 255, 255];
  }
  if (c.alpha < 1) {
    const canvas = parseColor(canvasRaw) || { rgb: [12, 16, 21], alpha: 1 };
    return over(c, canvas.rgb);
  }
  return c.rgb;
}

const THEMES = [
  { name: 'light', card: cardRgbOf(light['--card'], light['--canvas']), set: light },
  { name: 'dark', card: cardRgbOf(dark['--card'], dark['--canvas']), set: dark }
];
SKINS.forEach(function (slug) {
  const skin = skinData[slug];
  if (!parseColor(skin['--card'])) {
    return;
  }
  // A translucent card is composited over the skin's own canvas.
  const card = cardRgbOf(skin['--card'], skin['--canvas']);
  const base = lum(card) < 0.2 ? dark : light;
  THEMES.push({ name: slug, card: card, set: Object.assign({}, base, skin) });
});

THEMES.forEach(function (theme) {
  const cardRgb = theme.card;
  const bad = [];
  NAMES.forEach(function (n) {
    const c = parseColor(theme.set[n]);
    if (!c) {
      bad.push({ token: n, why: 'missing' });
      return;
    }
    const r = ratio(c.rgb, cardRgb);
    if (r < 3) {
      bad.push({ token: n, value: theme.set[n], ratio: Math.round(r * 100) / 100 });
    }
  });
  check('theme ' + theme.name + ': all nine slots clear 3:1 on its card', bad.length === 0, bad);
});

/* ---- arm 4: the three non-default skins override the set ---- */
['departure', 'obsidian', 'guild'].forEach(function (slug) {
  const skin = skinData[slug] || {};
  const own = NAMES.filter(n => skin[n]);
  check('skin ' + slug + ' re-points its own slots', own.length > 0, own);
});

/* ---- arm 5: the dark skins get the dark steps, guild keeps the light ones ---- */
['departure', 'obsidian'].forEach(function (slug) {
  const skin = skinData[slug] || {};
  const same = NAMES.filter(n => skin[n] && skin[n] === dark[n]);
  check('skin ' + slug + ' uses the dark steps', same.length === NAMES.length, {
    matched: same.length,
    of: NAMES.length
  });
});
{
  const guild = skinData.guild || {};
  const deepened = ['--major-4', '--major-6'].filter(n => guild[n] && guild[n] !== light[n]);
  check(
    'guild deepens the slots its parchment card cannot carry',
    deepened.length === 2 && !!guild['--major-other'],
    { deepened: deepened, other: guild['--major-other'] }
  );
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
