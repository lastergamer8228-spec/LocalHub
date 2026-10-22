/* knowledge.js - local knowledge base with relationships, search, import/export. */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  var Memory = global.LH_AI.Memory;
  var STORE = "knowledge";

  function genId() { return "kb_" + Date.now() + "_" + Math.random().toString(36).slice(2); }

  var Knowledge = {
    add: function (entry) {
      entry.id = entry.id || genId();
      entry.related = entry.related || [];
      return Memory.put(STORE, entry);
    },
    all: function () { return Memory.getAll(STORE); },
    remove: function (id) { return Memory.remove(STORE, id); },
    update: function (entry) { return Memory.put(STORE, entry); },
    relate: function (id, otherId) {
      return Memory.get(STORE, id).then(function (a) {
        if (!a) return;
        a.related = a.related || [];
        if (a.related.indexOf(otherId) < 0) a.related.push(otherId);
        return Memory.put(STORE, a);
      });
    },
    search: function (q) {
      q = (q || "").toLowerCase();
      return Memory.getAll(STORE).then(function (all) {
        return all.filter(function (e) {
          return (e.title + " " + (e.content || "") + " " + (e.tags || []).join(" "))
            .toLowerCase().indexOf(q) >= 0;
        });
      });
    },
    relatedOf: function (id) {
      return Memory.getAll(STORE).then(function (all) {
        return all.filter(function (e) { return e.id !== id && (e.related || []).indexOf(id) >= 0; });
      });
    },
    exportAll: function () {
      return Memory.getAll(STORE).then(function (all) {
        return JSON.stringify({ app: "LocalHub", type: "knowledge", items: all }, null, 2);
      });
    },
    importAll: function (json) {
      var data;
      try { data = JSON.parse(json); } catch (e) { return Promise.reject("invalid JSON"); }
      var items = data && data.items ? data.items : (Array.isArray(data) ? data : []);
      var chain = Promise.resolve();
      items.forEach(function (it) { chain = chain.then(function () { return Knowledge.add(it); }); });
      return chain;
    }
  };

  global.LH_AI.Knowledge = Knowledge;
})(window);
