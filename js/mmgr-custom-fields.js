/* ============================================================
   My MaNaGeR, custom task fields (NocoBase-inspired collection model)
   ------------------------------------------------------------
   The schema rules live here, once:
     - the field type table and its coercion
     - the field list: add, update, remove, reorder
     - value reads and writes on task.custom
     - required-field detection
     - the persisted board filter over a select field

   `state.fields` is the schema. `task.custom[key]` is the value.
   No function here touches the DOM, storage, or the network, so the
   whole module loads in Node under a vm sandbox for tests.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const KEY_PREFIX = 'cf_';
  const MAX_FIELDS = 20;
  const MAX_LABEL = 40;
  const MAX_TEXT = 200;
  const MIN_WIDTH = 60;
  const MAX_WIDTH = 300;

  function isCustomKey(key) {
    return typeof key === 'string' && key.indexOf(KEY_PREFIX) === 0;
  }

  function text(raw) {
    return String(raw == null ? '' : raw)
      .trim()
      .slice(0, MAX_TEXT);
  }

  function toDate(raw) {
    const v = text(raw);
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
  }

  function toNumber(raw) {
    if (raw === '' || raw == null) {
      return '';
    }
    const n = Number(raw);
    return isFinite(n) ? n : '';
  }

  const TYPES = {
    text: {
      id: 'text',
      label: 'Text',
      coerce: text,
      display: function (v) {
        return text(v);
      }
    },
    number: {
      id: 'number',
      label: 'Number',
      coerce: toNumber,
      display: function (v) {
        return v === '' || v == null ? '' : String(v);
      }
    },
    date: {
      id: 'date',
      label: 'Date',
      coerce: toDate,
      display: function (v) {
        return toDate(v);
      }
    },
    select: {
      id: 'select',
      label: 'Select',
      coerce: function (raw, field) {
        const v = text(raw);
        const options = (field && field.options) || [];
        return options.indexOf(v) > -1 ? v : '';
      },
      display: function (v) {
        return text(v);
      }
    },
    checkbox: {
      id: 'checkbox',
      label: 'Checkbox',
      coerce: function (raw) {
        return raw === true || raw === 'true' || raw === 'on' || raw === 1 || raw === '1';
      },
      display: function (v) {
        return v ? 'Yes' : 'No';
      }
    }
  };

  function typeOf(field) {
    return (field && TYPES[field.type]) || TYPES.text;
  }

  // The schema is the valid subset of state.fields. Junk entries left by a
  // hand-edited import are ignored rather than rendered as a broken column.
  function list(state) {
    const raw = state && Array.isArray(state.fields) ? state.fields : [];
    return raw.filter(function (f) {
      return f && isCustomKey(f.key) && TYPES[f.type];
    });
  }

  function find(state, key) {
    return (
      list(state).find(function (f) {
        return f.key === key;
      }) || null
    );
  }

  function sameLabel(state, label, exceptKey) {
    const needle = label.toLowerCase();
    return list(state).some(function (f) {
      return f.key !== exceptKey && f.label.toLowerCase() === needle;
    });
  }

  function clampWidth(raw) {
    const n = parseInt(raw, 10);
    if (!isFinite(n)) {
      return 120;
    }
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, n));
  }

  function normalizeOptions(raw) {
    const arr = Array.isArray(raw) ? raw : String(raw || '').split(',');
    const out = [];
    arr.forEach(function (option) {
      const v = text(option);
      if (v && out.indexOf(v) < 0) {
        out.push(v);
      }
    });
    return out;
  }

  // 'wbs' and 'card' are the two blocks My MaNaGeR renders. A field can
  // show in either, both, or neither; the value is stored either way.
  function visible(state, where) {
    return list(state).filter(function (f) {
      if (where === 'wbs') {
        return f.showInWbs !== false;
      }
      if (where === 'card') {
        return f.showInCard === true;
      }
      return true;
    });
  }

  function uniqueKey(state) {
    const base =
      ns.Utils && ns.Utils.genId ? ns.Utils.genId('cf') : 'cf_' + Date.now().toString(36);
    let key = base;
    let n = 1;
    while (find(state, key)) {
      key = base + '_' + n++;
    }
    return key;
  }

  function makeField(state, draft) {
    const label = text(draft && draft.label).slice(0, MAX_LABEL);
    const type = draft && TYPES[draft.type] ? draft.type : 'text';
    const options = type === 'select' ? normalizeOptions(draft.options) : [];
    return {
      key: uniqueKey(state),
      label: label || 'Untitled field',
      type: type,
      options: options,
      defaultValue: TYPES[type].coerce(draft && draft.defaultValue, { options: options }),
      required: !!(draft && draft.required),
      showInWbs: !(draft && draft.showInWbs === false),
      showInCard: !!(draft && draft.showInCard),
      width: clampWidth(draft && draft.width)
    };
  }

  function add(state, draft) {
    const label = text(draft && draft.label).slice(0, MAX_LABEL);
    if (!label) {
      return { ok: false, reason: 'A field needs a label.' };
    }
    const type = draft && draft.type;
    if (!TYPES[type]) {
      return { ok: false, reason: 'Unknown field type.' };
    }
    if (type === 'select' && normalizeOptions(draft.options).length === 0) {
      return { ok: false, reason: 'A select field needs at least one option.' };
    }
    if (sameLabel(state, label, '')) {
      return { ok: false, reason: 'A field with that label already exists.' };
    }
    if (list(state).length >= MAX_FIELDS) {
      return { ok: false, reason: 'A project can carry at most ' + MAX_FIELDS + ' custom fields.' };
    }
    const field = makeField(state, draft);
    if (!Array.isArray(state.fields)) {
      state.fields = [];
    }
    state.fields.push(field);
    return { ok: true, field: field };
  }

  function update(state, key, patch) {
    const field = find(state, key);
    if (!field) {
      return { ok: false, reason: 'That field no longer exists.' };
    }
    if (!patch || typeof patch !== 'object') {
      return { ok: false, reason: 'Nothing to update.' };
    }
    // Deliberately no `type` branch. A type swap would reinterpret values
    // already stored on every task, which is the silent cast NocoBase
    // refuses at collection.ts:471-504.
    if (Object.prototype.hasOwnProperty.call(patch, 'label')) {
      const label = text(patch.label).slice(0, MAX_LABEL);
      if (!label) {
        return { ok: false, reason: 'A field needs a label.' };
      }
      if (sameLabel(state, label, key)) {
        return { ok: false, reason: 'A field with that label already exists.' };
      }
      field.label = label;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'options') && field.type === 'select') {
      const options = normalizeOptions(patch.options);
      if (!options.length) {
        return { ok: false, reason: 'A select field needs at least one option.' };
      }
      field.options = options;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'showInWbs')) {
      field.showInWbs = !!patch.showInWbs;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'showInCard')) {
      field.showInCard = !!patch.showInCard;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'required')) {
      field.required = !!patch.required;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'width')) {
      field.width = clampWidth(patch.width);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'defaultValue')) {
      field.defaultValue = typeOf(field).coerce(patch.defaultValue, field);
    }
    return { ok: true, field: field };
  }

  function remove(state, key) {
    const fields = list(state);
    const at = fields.findIndex(function (f) {
      return f.key === key;
    });
    if (at < 0) {
      return { ok: false, reason: 'That field no longer exists.' };
    }
    const field = fields[at];
    state.fields = fields.slice(0, at).concat(fields.slice(at + 1));
    if (Array.isArray(state.tasks)) {
      state.tasks.forEach(function (t) {
        if (t && t.custom && Object.prototype.hasOwnProperty.call(t.custom, key)) {
          delete t.custom[key];
        }
      });
    }
    if (state.cfFilter && state.cfFilter.key === key) {
      state.cfFilter = { key: '', value: '' };
    }
    return { ok: true, field: field };
  }

  function move(state, key, delta) {
    const fields = list(state).slice();
    const at = fields.findIndex(function (f) {
      return f.key === key;
    });
    const to = at + (delta < 0 ? -1 : 1);
    if (at < 0 || to < 0 || to >= fields.length) {
      return false;
    }
    const held = fields[at];
    fields[at] = fields[to];
    fields[to] = held;
    state.fields = fields;
    return true;
  }

  function valueOf(task, field) {
    if (!task || !field) {
      return '';
    }
    const bag = task.custom && typeof task.custom === 'object' ? task.custom : {};
    if (Object.prototype.hasOwnProperty.call(bag, field.key)) {
      return typeOf(field).coerce(bag[field.key], field);
    }
    return typeOf(field).coerce(field.defaultValue, field);
  }

  function hasValue(task, field) {
    const value = valueOf(task, field);
    return field.type === 'checkbox' ? value === true : value !== '' && value != null;
  }

  function setValue(state, task, key, raw) {
    const field = find(state, key);
    if (!task || !field) {
      return { ok: false, reason: 'Unknown field.' };
    }
    if (!task.custom || typeof task.custom !== 'object' || Array.isArray(task.custom)) {
      task.custom = {};
    }
    const value = typeOf(field).coerce(raw, field);
    task.custom[field.key] = value;
    return { ok: true, value: value, field: field };
  }

  function missing(state, task) {
    return list(state).filter(function (f) {
      return f.required && !hasValue(task, f);
    });
  }

  // Drop values whose field no longer exists. `remove()` does this for one
  // field; this repairs a state that arrived from an older or foreign file.
  function prune(state) {
    const keys = {};
    list(state).forEach(function (f) {
      keys[f.key] = 1;
    });
    const tasks = (state && state.tasks) || [];
    tasks.forEach(function (t) {
      if (!t || !t.custom || typeof t.custom !== 'object') {
        return;
      }
      Object.keys(t.custom).forEach(function (key) {
        if (!keys[key]) {
          delete t.custom[key];
        }
      });
    });
  }

  function filterFields(state) {
    return list(state).filter(function (f) {
      return f.type === 'select';
    });
  }

  // The filter is only valid while its field exists and is a select. Any
  // stale combination reads as "no filter" instead of hiding the board.
  function filter(state) {
    const f = state && state.cfFilter;
    if (!f || !f.key) {
      return { key: '', value: '' };
    }
    const field = find(state, f.key);
    if (!field || field.type !== 'select' || !f.value) {
      return { key: '', value: '' };
    }
    return { key: f.key, value: String(f.value) };
  }

  function setFilter(state, key, value) {
    const field = find(state, key);
    if (!field || field.type !== 'select' || !value) {
      state.cfFilter = { key: '', value: '' };
    } else {
      state.cfFilter = { key: field.key, value: String(value) };
    }
    return state.cfFilter;
  }

  function matchesFilter(state, task) {
    const active = filter(state);
    if (!active.key) {
      return true;
    }
    const field = find(state, active.key);
    if (!field) {
      return true;
    }
    return valueOf(task, field) === active.value;
  }

  ns.CustomFields = {
    KEY_PREFIX: KEY_PREFIX,
    MAX_FIELDS: MAX_FIELDS,
    MIN_WIDTH: MIN_WIDTH,
    MAX_WIDTH: MAX_WIDTH,
    TYPES: TYPES,
    isCustomKey: isCustomKey,
    list: list,
    find: find,
    visible: visible,
    add: add,
    update: update,
    remove: remove,
    move: move,
    valueOf: valueOf,
    hasValue: hasValue,
    setValue: setValue,
    missing: missing,
    prune: prune,
    filterFields: filterFields,
    filter: filter,
    setFilter: setFilter,
    matchesFilter: matchesFilter,
    clampWidth: clampWidth
  };
})(MMGR);
window.MMGR = MMGR;
