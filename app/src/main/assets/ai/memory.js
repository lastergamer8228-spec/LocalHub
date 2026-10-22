/* memory.js - Local persistence via IndexedDB. All AI data stays on device. */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  var DB_NAME = "localhub_ai";
  var DB_VERSION = 1;

  function open() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        ["memories", "knowledge", "tasks", "automations", "plugins", "settings", "chats"].forEach(function (s) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function store(name) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(name, "readwrite");
        resolve({
          db: db, tx: tx,
          os: tx.objectStore(name)
        });
      });
    });
  }

  var Memory = {
    open: open,
    put: function (storeName, obj) {
      if (!obj.id) obj.id = (storeName + "_" + Date.now() + "_" + Math.random().toString(36).slice(2));
      if (!obj.createdAt) obj.createdAt = Date.now();
      obj.updatedAt = Date.now();
      return store(storeName).then(function (s) {
        return new Promise(function (resolve, reject) {
          var req = s.os.put(obj);
          req.onsuccess = function () { s.tx.oncomplete = function () { s.db.close(); resolve(obj); }; };
          req.onerror = function () { reject(req.error); };
        });
      });
    },
    getAll: function (storeName) {
      return store(storeName).then(function (s) {
        return new Promise(function (resolve, reject) {
          var req = s.os.getAll();
          req.onsuccess = function () { s.tx.oncomplete = function () { s.db.close(); resolve(req.result || []); }; };
          req.onerror = function () { reject(req.error); };
        });
      });
    },
    get: function (storeName, id) {
      return store(storeName).then(function (s) {
        return new Promise(function (resolve, reject) {
          var req = s.os.get(id);
          req.onsuccess = function () { s.tx.oncomplete = function () { s.db.close(); resolve(req.result); }; };
          req.onerror = function () { reject(req.error); };
        });
      });
    },
    remove: function (storeName, id) {
      return store(storeName).then(function (s) {
        return new Promise(function (resolve, reject) {
          var req = s.os.delete(id);
          req.onsuccess = function () { s.tx.oncomplete = function () { s.db.close(); resolve(); }; };
          req.onerror = function () { reject(req.error); };
        });
      });
    },
    clear: function (storeName) {
      return store(storeName).then(function (s) {
        return new Promise(function (resolve, reject) {
          var req = s.os.clear();
          req.onsuccess = function () { s.tx.oncomplete = function () { s.db.close(); resolve(); }; };
          req.onerror = function () { reject(req.error); };
        });
      });
    }
  };

  global.LH_AI = global.LH_AI || {};
  global.LH_AI.Memory = Memory;
})(window);
