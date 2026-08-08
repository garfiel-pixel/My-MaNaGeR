/* ============================================================
   My MaNaGeR — Closure, Comms & Documents Management Module
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;
  const R = ns.Render;

  // ---- Closure ----
  function addCloseItem() {
    ns.State.updateState(function(s) {
      if (!s.closure) s.closure = { items: [], well: '', imp: '', rec: '' };
      if (!s.closure.items) s.closure.items = [];
      s.closure.items.push({ text: '', done: false });
    });
    R.renderClosure();
  }

  function updCloseItem(index, done) {
    ns.State.updateState(function(s) {
      if (s.closure && s.closure.items && s.closure.items[index]) {
        s.closure.items[index].done = !!done;
      }
    });
    R.renderClosure(); // reflect the checkbox strikethrough immediately
  }

  function delCloseItem(index) {
    ns.State.updateState(function(s) {
      if (s.closure && s.closure.items) s.closure.items.splice(index, 1);
    });
    R.renderClosure();
  }

  function updClose(field, value) {
    ns.State.updateState(function(s) {
      if (!s.closure) s.closure = { items: [], well: '', imp: '', rec: '' };
      s.closure[field] = value;
    });
  }

  // ---- Comms ----
  function addComms() {
    ns.State.updateState(function(s) {
      if (!s.commsEntries) s.commsEntries = [];
      s.commsEntries.push({
        id: U.genShortId('C'), date: U.todayStr(), type: 'Meeting',
        attendees: '', summary: '', actionItems: '', followUp: ''
      });
    });
    R.renderComms();
  }

  function updComms(index, field, value) {
    ns.State.updateState(function(s) {
      if (s.commsEntries && s.commsEntries[index]) s.commsEntries[index][field] = value;
    });
  }

  function delComms(index) {
    ns.State.updateState(function(s) {
      if (s.commsEntries) s.commsEntries.splice(index, 1);
    });
    R.renderComms();
  }

  // ---- Documents ----
  function addDoc() {
    ns.State.updateState(function(s) {
      if (!s.documents) s.documents = [];
      s.documents.push({
        id: U.genShortId('D'), docNo: '', title: '', type: 'Drawing',
        version: '1', status: 'current', responsible: '', dateIssued: '', notes: ''
      });
    });
    R.renderDocuments();
  }

  function updDoc(index, field, value) {
    ns.State.updateState(function(s) {
      if (s.documents && s.documents[index]) s.documents[index][field] = value;
    });
  }

  function delDoc(index) {
    ns.State.updateState(function(s) {
      if (s.documents) s.documents.splice(index, 1);
    });
    R.renderDocuments();
  }

  // ---- API ----
  ns.Closure = {
    addCloseItem: addCloseItem,
    updCloseItem: updCloseItem,
    delCloseItem: delCloseItem,
    updClose: updClose
  };

  ns.Comms = {
    addComms: addComms,
    updComms: updComms,
    delComms: delComms
  };

  ns.Documents = {
    addDoc: addDoc,
    updDoc: updDoc,
    delDoc: delDoc
  };

})(MMGR);
window.MMGR = MMGR;