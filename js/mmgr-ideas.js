/* ============================================================
   My MaNaGeR, idea intake model (Leantime-inspired)
   ------------------------------------------------------------
   The intake rules live here, once:
     - the six canvas stages and their order
     - the idea record and its normalisation
     - add, update, remove
     - one atomic drop: every card in the payload lands or none does
     - the priority score (impact x2 - effort)
     - the promote link to a WBS task

   No DOM, no storage, no timers. The Node test loads this file in a
   vm sandbox, so keep every dependency behind ns.Utils.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  // Stage keys are the stored values. Labels are display only.
  const STAGES = [
    { key: 'idea', label: 'Idea', hint: 'Captured, not yet examined' },
    { key: 'research', label: 'Research', hint: 'Gathering facts and constraints' },
    { key: 'prototype', label: 'Prototype', hint: 'Testing a cheap version' },
    { key: 'validation', label: 'Validation', hint: 'Proving value before commitment' },
    { key: 'implemented', label: 'Implemented', hint: 'Promoted and delivered' },
    { key: 'deferred', label: 'Deferred', hint: 'Parked with a reason' }
  ];
  const STAGE_KEYS = STAGES.map(function (s) {
    return s.key;
  });
  const STAGE_LABEL = {};
  STAGES.forEach(function (s) {
    STAGE_LABEL[s.key] = s.label;
  });
  // Terminal stages stay out of the agenda feed: an implemented or parked
  // idea is not work coming up.
  const TERMINAL = { implemented: true, deferred: true };
  const MAX_TEXT = 2000;
  const MAX_TAGS = 8;
  const MAX_TAG_LEN = 24;

  function isStage(key) {
    return Object.prototype.hasOwnProperty.call(STAGE_LABEL, key);
  }

  function clampInt(v, lo, hi, fallback) {
    const n = parseInt(v, 10);
    if (isNaN(n)) {
      return fallback;
    }
    if (n < lo) {
      return lo;
    }
    if (n > hi) {
      return hi;
    }
    return n;
  }

  function text(v) {
    if (v === null || v === undefined) {
      return '';
    }
    return String(v).slice(0, MAX_TEXT);
  }

  function tagList(v) {
    if (!Array.isArray(v)) {
      return [];
    }
    const out = [];
    const seen = {};
    v.forEach(function (raw) {
      const t = String(raw === null || raw === undefined ? '' : raw)
        .trim()
        .slice(0, MAX_TAG_LEN);
      if (!t) {
        return;
      }
      const k = t.toLowerCase();
      if (seen[k]) {
        return;
      }
      seen[k] = 1;
      out.push(t);
    });
    return out.slice(0, MAX_TAGS);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function genId() {
    if (ns.Utils && typeof ns.Utils.genId === 'function') {
      return ns.Utils.genId('i');
    }
    return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // Impact weighs twice: a high-impact, cheap idea outranks a low-impact,
  // expensive one. The range is -3 (impact 1, effort 5) to 9 (impact 5,
  // effort 1). Zero is the neutral midpoint and reads as "worth a look".
  function score(idea) {
    if (!idea) {
      return 0;
    }
    return clampInt(idea.impact, 1, 5, 3) * 2 - clampInt(idea.effort, 1, 5, 3);
  }

  function find(state, id) {
    if (!state || !Array.isArray(state.ideas) || typeof id !== 'string') {
      return null;
    }
    for (let i = 0; i < state.ideas.length; i++) {
      if (state.ideas[i] && state.ideas[i].id === id) {
        return state.ideas[i];
      }
    }
    return null;
  }

  function nextOrder(state, stage) {
    let max = -1;
    (state && Array.isArray(state.ideas) ? state.ideas : []).forEach(function (idea) {
      if (idea && idea.stage === stage && typeof idea.order === 'number' && idea.order > max) {
        max = idea.order;
      }
    });
    return max + 1;
  }

  // Every field is coerced, so one bad import cannot crash a renderer.
  // `order` and the two timestamps are owned by the model, never the form.
  function normalize(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const stage = isStage(src.stage) ? src.stage : 'idea';
    return {
      id: typeof src.id === 'string' && src.id ? src.id : String(src.id || ''),
      title: text(src.title).trim(),
      summary: text(src.summary).trim(),
      stage: stage,
      author: text(src.author).trim(),
      tags: tagList(src.tags),
      impact: clampInt(src.impact, 1, 5, 3),
      effort: clampInt(src.effort, 1, 5, 3),
      order: clampInt(src.order, 0, 1000000, 0),
      createdAt: typeof src.createdAt === 'string' && src.createdAt ? src.createdAt : '',
      updatedAt: typeof src.updatedAt === 'string' && src.updatedAt ? src.updatedAt : '',
      promotedTaskId: typeof src.promotedTaskId === 'string' ? src.promotedTaskId : ''
    };
  }

  function add(state, input) {
    if (!state) {
      return null;
    }
    if (!Array.isArray(state.ideas)) {
      state.ideas = [];
    }
    const src = input || {};
    const title = text(src.title).trim();
    if (!title) {
      return null;
    }
    const stage = isStage(src.stage) ? src.stage : 'idea';
    const iso = nowIso();
    const idea = normalize({
      id: src.id,
      title: title,
      summary: src.summary,
      stage: stage,
      author: src.author,
      tags: src.tags,
      impact: src.impact,
      effort: src.effort,
      order: nextOrder(state, stage),
      createdAt: iso,
      updatedAt: iso,
      promotedTaskId: ''
    });
    if (!idea.id) {
      idea.id = genId();
    }
    // A duplicate id would shadow a card and make the drop ambiguous.
    if (find(state, idea.id)) {
      return null;
    }
    state.ideas.push(idea);
    return idea;
  }

  const EDITABLE = {
    title: 1,
    summary: 1,
    stage: 1,
    author: 1,
    tags: 1,
    impact: 1,
    effort: 1
  };

  function update(state, id, patch) {
    const idea = find(state, id);
    if (!idea || !patch || typeof patch !== 'object') {
      return false;
    }
    let changed = false;
    Object.keys(patch).forEach(function (key) {
      if (!EDITABLE[key]) {
        return;
      }
      let value = patch[key];
      if (key === 'title') {
        value = text(value).trim();
        if (!value) {
          return;
        }
      } else if (key === 'summary' || key === 'author') {
        value = text(value).trim();
      } else if (key === 'tags') {
        value = tagList(value);
      } else if (key === 'impact' || key === 'effort') {
        value = clampInt(value, 1, 5, 3);
      } else if (key === 'stage') {
        if (!isStage(value)) {
          return;
        }
        if (value === idea.stage) {
          return;
        }
        // Appended to the new column, so a stage change never lands mid-list.
        idea.order = nextOrder(state, value);
      }
      idea[key] = value;
      changed = true;
    });
    if (changed) {
      idea.updatedAt = nowIso();
    }
    return changed;
  }

  function remove(state, id) {
    if (!state || !Array.isArray(state.ideas)) {
      return false;
    }
    for (let i = 0; i < state.ideas.length; i++) {
      if (state.ideas[i] && state.ideas[i].id === id) {
        state.ideas.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  function byOrder(a, b) {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return String(a.createdAt).localeCompare(String(b.createdAt));
  }

  // One drop, all or nothing. The Leantime controller posts a sort payload
  // per card and rejects the whole request when any card is outside the
  // caller's scope; this is the same fence, expressed as validation before
  // the first mutation. A drop never half-lands.
  function applyDrop(state, moves) {
    if (!state || !Array.isArray(state.ideas)) {
      return false;
    }
    if (!Array.isArray(moves) || moves.length === 0) {
      return false;
    }
    const seen = {};
    for (let i = 0; i < moves.length; i++) {
      const mv = moves[i];
      if (!mv || typeof mv !== 'object') {
        return false;
      }
      if (typeof mv.id !== 'string' || !mv.id) {
        return false;
      }
      if (seen[mv.id]) {
        return false;
      }
      seen[mv.id] = 1;
      if (!isStage(mv.stage)) {
        return false;
      }
      if (!Number.isInteger(mv.order) || mv.order < 0) {
        return false;
      }
      if (!find(state, mv.id)) {
        return false;
      }
    }
    // Validation passed: from here the drop always lands whole.
    const affected = {};
    moves.forEach(function (mv) {
      affected[mv.stage] = 1;
      const current = find(state, mv.id);
      if (current) {
        affected[current.stage] = 1;
      }
    });
    const byStage = {};
    moves.forEach(function (mv) {
      (byStage[mv.stage] = byStage[mv.stage] || []).push(mv);
    });
    Object.keys(byStage).forEach(function (stage) {
      const incoming = byStage[stage].slice().sort(function (a, b) {
        return a.order - b.order;
      });
      const moved = {};
      incoming.forEach(function (mv) {
        moved[mv.id] = 1;
      });
      const column = state.ideas
        .filter(function (idea) {
          return idea.stage === stage && !moved[idea.id];
        })
        .sort(byOrder);
      incoming.forEach(function (mv) {
        const at = Math.min(mv.order, column.length);
        const idea = find(state, mv.id);
        idea.stage = stage;
        column.splice(at, 0, idea);
      });
      column.forEach(function (idea, idx) {
        idea.order = idx;
      });
    });
    // Close the gap left behind in every source column, and stamp the move.
    const iso = nowIso();
    Object.keys(affected).forEach(function (stage) {
      state.ideas
        .filter(function (idea) {
          return idea.stage === stage;
        })
        .sort(byOrder)
        .forEach(function (idea, idx) {
          idea.order = idx;
          idea.updatedAt = iso;
        });
    });
    return true;
  }

  // The promote link is one-way and one task per idea. It records the link
  // and stops: the stage is the user's call, so an idea can be promoted at
  // research and still be validated later.
  function promote(state, id, taskId) {
    const idea = find(state, id);
    if (!idea) {
      return false;
    }
    if (typeof taskId !== 'string' || !taskId) {
      return false;
    }
    if (idea.promotedTaskId) {
      return false;
    }
    idea.promotedTaskId = taskId;
    idea.updatedAt = nowIso();
    return true;
  }

  // A deleted task must not leave a card claiming a task that no longer
  // exists. Called from Tasks.delTask inside the same update, so the task and
  // every link to it go together. Returns the number of ideas unlinked.
  function unlink(state, taskId) {
    if (!state || !Array.isArray(state.ideas) || typeof taskId !== 'string' || !taskId) {
      return 0;
    }
    let n = 0;
    state.ideas.forEach(function (idea) {
      if (idea && idea.promotedTaskId === taskId) {
        idea.promotedTaskId = '';
        idea.updatedAt = nowIso();
        n += 1;
      }
    });
    return n;
  }

  // Make any loaded or imported row renderable. Migrations only create the
  // empty container (mmgr-state.js loads before this file, so it cannot call
  // this function); the renderer calls repair() once per draw. It is
  // idempotent, so the second call reports zero changes. The array is
  // replaced, so a caller that wraps this in updateState() still marks
  // `ideas` dirty; the renderer uses save() instead (see render/ideas.js).
  function repair(state) {
    if (!state) {
      return 0;
    }
    let changed = 0;
    if (!Array.isArray(state.ideas)) {
      state.ideas = [];
      changed += 1;
    }
    const seen = {};
    const kept = [];
    // A link to a task that is no longer in the state is a lie on the card.
    // Only validate when the task list is present: a partial state without
    // `tasks` must not be read as "every task was deleted".
    const taskIds = {};
    const hasTasks = Array.isArray(state.tasks);
    if (hasTasks) {
      state.tasks.forEach(function (t) {
        if (t && t.id) {
          taskIds[t.id] = 1;
        }
      });
    }
    state.ideas.forEach(function (raw) {
      if (!raw || typeof raw !== 'object') {
        changed += 1;
        return;
      }
      const fixed = normalize(raw);
      if (!fixed.id || seen[fixed.id]) {
        fixed.id = genId();
        changed += 1;
      }
      if (!fixed.title) {
        // A titleless row is not a card, and inventing one would hide the
        // fact that the import was broken.
        changed += 1;
        return;
      }
      if (hasTasks && fixed.promotedTaskId && !taskIds[fixed.promotedTaskId]) {
        fixed.promotedTaskId = '';
        changed += 1;
      }
      if (
        fixed.stage !== raw.stage ||
        fixed.impact !== raw.impact ||
        fixed.effort !== raw.effort ||
        fixed.order !== raw.order
      ) {
        changed += 1;
      }
      seen[fixed.id] = 1;
      kept.push(fixed);
    });
    const out = [];
    STAGE_KEYS.forEach(function (key) {
      const column = kept.filter(function (idea) {
        return idea.stage === key;
      });
      column.sort(byOrder);
      column.forEach(function (idea, idx) {
        if (idea.order !== idx) {
          changed += 1;
        }
        idea.order = idx;
        out.push(idea);
      });
    });
    state.ideas = out;
    return changed;
  }

  function byStage(state) {
    const list = state && Array.isArray(state.ideas) ? state.ideas : [];
    return STAGES.map(function (stage) {
      return {
        key: stage.key,
        label: stage.label,
        hint: stage.hint,
        ideas: list
          .filter(function (idea) {
            return idea && idea.stage === stage.key;
          })
          .sort(byOrder)
      };
    });
  }

  function filter(state, opts) {
    const o = opts || {};
    const q = o.q ? String(o.q).trim().toLowerCase() : '';
    const tag = o.tag ? String(o.tag).trim().toLowerCase() : '';
    const list = state && Array.isArray(state.ideas) ? state.ideas : [];
    return list.filter(function (idea) {
      if (!idea) {
        return false;
      }
      if (tag) {
        const tags = (idea.tags || []).map(function (t) {
          return String(t).toLowerCase();
        });
        if (tags.indexOf(tag) === -1) {
          return false;
        }
      }
      if (!q) {
        return true;
      }
      const hay = [idea.title, idea.summary, idea.author, (idea.tags || []).join(' ')]
        .join(' ')
        .toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function tags(state) {
    const seen = {};
    const out = [];
    (state && Array.isArray(state.ideas) ? state.ideas : []).forEach(function (idea) {
      (idea && Array.isArray(idea.tags) ? idea.tags : []).forEach(function (t) {
        const k = String(t).toLowerCase();
        if (!k || seen[k]) {
          return;
        }
        seen[k] = 1;
        out.push(String(t));
      });
    });
    out.sort(function (a, b) {
      return a.toLowerCase().localeCompare(b.toLowerCase());
    });
    return out;
  }

  function stats(state) {
    const counts = {};
    STAGE_KEYS.forEach(function (k) {
      counts[k] = 0;
    });
    let total = 0;
    let promoted = 0;
    (state && Array.isArray(state.ideas) ? state.ideas : []).forEach(function (idea) {
      if (!idea) {
        return;
      }
      total += 1;
      if (counts[idea.stage] !== undefined) {
        counts[idea.stage] += 1;
      }
      if (idea.promotedTaskId) {
        promoted += 1;
      }
    });
    return {
      total: total,
      counts: counts,
      promoted: promoted,
      open: total - counts.implemented - counts.deferred
    };
  }

  ns.Ideas = {
    STAGES: STAGES,
    TERMINAL: TERMINAL,
    isStage: isStage,
    score: score,
    normalize: normalize,
    find: find,
    add: add,
    update: update,
    remove: remove,
    applyDrop: applyDrop,
    promote: promote,
    unlink: unlink,
    repair: repair,
    byStage: byStage,
    filter: filter,
    tags: tags,
    stats: stats
  };
})(MMGR);
