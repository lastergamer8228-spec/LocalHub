/* tasks.js - background/queued task registry, runnable by the brain. */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  var Memory = global.LH_AI.Memory;
  var STORE = "tasks";

  var Tasks = {
    all: function () { return Memory.getAll(STORE); },
    add: function (task) {
      task.type = task.type || "task";
      task.status = task.status || "pending";
      task.createdAt = task.createdAt || Date.now();
      return Memory.put(STORE, task);
    },
    update: function (task) { return Memory.put(STORE, task); },
    remove: function (id) { return Memory.remove(STORE, id); },
    clear: function () { return Memory.clear(STORE); },
    runOne: async function (task, runner) {
      task.status = "running";
      task.startedAt = Date.now();
      try {
        task.result = await runner(task);
        task.status = "done";
        task.finishedAt = Date.now();
      } catch (e) {
        task.status = "error";
        task.error = e.message || String(e);
        task.finishedAt = Date.now();
      }
      await Memory.put(STORE, task);
      return task;
    }
  };

  global.LH_AI.Tasks = Tasks;
})(window);
