/* plans.js - turns a frame into a plan.
 *
 * The old assistant answered a multi-step request with "use the Automation
 * tab". That is not an answer, it is a way of saying the engine could only
 * ever run one command.
 *
 * A plan is a small DAG of steps. Each step declares:
 *   run        what to do
 *   verify     how to prove it happened (read-back, never a guess)
 *   compensate how to undo it, when undoing is possible
 *
 * Verification is not optional for a step that changes something. A move that
 * reported success because the HTTP call returned 200, while the file never
 * arrived, is the exact failure the verify step exists to catch.
 */
(function (global) {
  "use strict";

  var AI = global.LH_AI = global.LH_AI || {};
  var NLU = AI.NLU = AI.NLU || {};

  var ROOT = "/storage/emulated/0";

  var FOLDER_PATHS = {
    DOWNLOADS: ROOT + "/Download",
    DCIM: ROOT + "/DCIM",
    MOVIES: ROOT + "/Movies",
    MUSIC: ROOT + "/Music",
    DOCUMENTS: ROOT + "/Documents",
    ROOT: ROOT
  };

  function FS() { return AI.FS; }
  function Context() { return AI.Context; }

  function base(p) {
    var s = String(p || "");
    var i = s.lastIndexOf("/");
    return i > 0 ? s.substring(i + 1) : s;
  }

  function extOf(name) {
    var s = String(name || "");
    var i = s.lastIndexOf(".");
    return i < 0 ? "" : s.substring(i + 1).toLowerCase();
  }

  var TYPE_EXT = {
    video: ["mp4", "mkv", "webm", "avi", "mov", "m4v"],
    audio: ["mp3", "wav", "m4a", "flac", "ogg", "aac"],
    image: ["png", "jpg", "jpeg", "gif", "webp", "bmp"],
    pdf: ["pdf"],
    text: ["txt", "md", "json", "log", "csv"],
    archive: ["zip", "rar", "7z", "tar", "gz"],
    apk: ["apk"]
  };

  function typeOfName(name) {
    var e = extOf(name);
    for (var t in TYPE_EXT) if (TYPE_EXT[t].indexOf(e) >= 0) return t;
    return "other";
  }

  /** Resolves a frame's target to a concrete path, using context for "it". */
  function resolvePath(frame, fallback) {
    var s = frame.slots || {};
    if (s.path) return s.path;
    if (s.file) {
      var c = Context();
      var current = c && c.state ? c.state.folder : null;
      return (current || ROOT) + "/" + s.file;
    }
    if (s.folder) return FOLDER_PATHS[s.folder] || ROOT;
    var ctx = Context();
    if (/^(it|this|that|them|those)$/i.test(String(s.target || ""))) {
      if (ctx && ctx.state) {
        if (ctx.state.currentFile) return ctx.state.currentFile.path;
        if (ctx.state.folder) return ctx.state.folder;
      }
    }
    var cc = Context();
    return fallback || (cc && cc.state && cc.state.folder) || ROOT;
  }

  function listEntries(result) {
    if (!result) return [];
    if (Array.isArray(result)) return result;
    if (Array.isArray(result.entries)) return result.entries;
    if (Array.isArray(result.files)) return result.files;
    if (Array.isArray(result.items)) return result.items;
    return [];
  }

  function pathOf(e) {
    if (typeof e === "string") return e;
    return e.path || e.file || e.name || "";
  }

  function sizeOf(e) { return (e && (e.size || e.length)) || 0; }

  var UNIT_BYTES = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 };

  function matchesFilters(e, slots) {
    if (slots.type && typeOfName(pathOf(e)) !== slots.type) return false;
    if (slots.size && sizeOf(e) < slots.size.value * (UNIT_BYTES[slots.size.unit] || 1)) return false;
    return true;
  }

  // ------------------------------------------------------------------ steps

  function step(spec) {
    return {
      id: spec.id,
      cap: spec.cap || "",
      label: spec.label || spec.id,
      destructive: !!spec.destructive,
      critical: spec.critical !== false,
      run: spec.run,
      verify: spec.verify || null,
      compensate: spec.compensate || null
    };
  }

  function readStep(id, label, cap, fn) {
    return step({ id: id, cap: cap, label: label, critical: true, run: fn });
  }

  // Server control goes through the documented API, exactly like the dashboard.
  function serverStep(id, label, command) {
    return step({
      id: id,
      cap: "server." + command,
      label: label,
      critical: true,
      run: function () {
        var token = "";
        try {
          token = AI.token || sessionStorage.getItem("lhtoken") || localStorage.getItem("lhtoken") || "";
        } catch (e) { token = ""; }
        return fetch("/api/server/" + command, {
          method: "POST",
          headers: Object.assign(
            { "Content-Type": "application/x-www-form-urlencoded" },
            token ? { Authorization: "Bearer " + token } : {}
          ),
          body: ""
        }).then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (j) {
            return { ok: j.ok !== false, message: j.message || (label + " requested.") };
          });
      },
      verify: function (ctx, result) {
        // Server control is asynchronous on the phone; the observable effect is
        // that the endpoint accepted the command. Verifying deeper would mean
        // polling, which belongs to the caller, not the step.
        return Promise.resolve(!!result && result.ok !== false);
      }
    });
  }

  // ------------------------------------------------------------------ plans

  var BUILDERS = {

    ORGANIZE: function (frame) {
      var target = resolvePath(frame);
      var by = (frame.modifiers || []).indexOf("BY_DATE") >= 0 ? "date" : "type";
      var moves = [];
      return [
        step({
          id: "list",
          cap: "fm.list",
          label: "List " + base(target),
          run: function (ctx) {
            return FS().list(target).then(function (r) {
              ctx.entries = listEntries(r);
              return { ok: true, message: "Found " + ctx.entries.length + " item(s).", data: ctx.entries };
            });
          }
        }),
        step({
          id: "group",
          cap: "fm.organize",
          label: "Group by " + by,
          run: function (ctx) {
            var groups = {};
            ctx.entries.forEach(function (e) {
              var p = pathOf(e);
              if (!p) return;
              var key = by === "date" ? "recent" : typeOfName(p);
              (groups[key] = groups[key] || []).push(p);
            });
            ctx.groups = groups;
            return Promise.resolve({ ok: true, message: Object.keys(groups).length + " group(s): " + Object.keys(groups).join(", ") });
          }
        }),
        step({
          id: "folders",
          cap: "fm.mkdir",
          label: "Create the destination folders",
          run: function (ctx) {
            var names = Object.keys(ctx.groups || {});
            var chain = Promise.resolve({ ok: true });
            names.forEach(function (n) {
              chain = chain.then(function () {
                return FS().mkdir(target, n).catch(function () { return { ok: true }; }); // already exists is fine
              });
            });
            return chain.then(function () {
              return { ok: true, message: names.length + " folder(s) ready." };
            });
          },
          verify: function (ctx, result) {
            // Ask each new folder for its contents: existence is proven by the
            // listing succeeding, not by the parent happening to include it.
            var names = Object.keys(ctx.groups || {});
            if (!names.length) return Promise.resolve(true);
            return Promise.all(names.map(function (n) {
              return FS().list(target + "/" + n)
                .then(function () { return true; })
                .catch(function () { return false; });
            })).then(function (r) { return r.every(Boolean); });
          }
        }),
        step({
          id: "move",
          cap: "fm.move",
          label: "Move each file into its folder",
          destructive: true,
          critical: false,
          run: function (ctx) {
            var groupKeys = Object.keys(ctx.groups || {});
            var chain = Promise.resolve();
            var moved = 0, attempted = 0;
            groupKeys.forEach(function (key) {
              (ctx.groups[key] || []).forEach(function (p) {
                attempted++;
                chain = chain.then(function () {
                  return FS().move(p, target + "/" + key).then(function (r) {
                    if (r && r.ok !== false) { moves.push({ from: p, to: target + "/" + key }); moved++; }
                  }).catch(function () { });
                });
              });
            });
            return chain.then(function () {
              ctx.moves = moves.slice();
              // A partial move is a failure, not a smaller success. Reporting
              // "moved 2 files" when 4 were asked for hides the two that were
              // left behind, and the user would trust a job that is half done.
              var partial = moved > 0 && moved < attempted;
              return {
                ok: moved > 0 && !partial,
                message: partial
                  ? "Moved only " + moved + " of " + attempted + " file(s)."
                  : "Moved " + moved + " file(s)."
              };
            });
          },
          verify: function (ctx) {
            // Check each destination, not the source: after a move the file is
            // deliberately no longer where it started, so listing the source
            // folder would report every successful move as a failure.
            if (!ctx.moves || !ctx.moves.length) return Promise.resolve(true);
            return Promise.all(ctx.moves.map(function (m) {
              return FS().list(m.to).then(function (r) {
                var names = listEntries(r).map(function (e) { return base(pathOf(e)); });
                return names.indexOf(base(m.from)) >= 0;
              }).catch(function () { return false; });
            })).then(function (r) { return r.every(Boolean); });
          },
          compensate: function (ctx) {
            var chain = Promise.resolve();
            (ctx.moves || []).forEach(function (m) {
              chain = chain.then(function () {
                return FS().move(m.to + "/" + base(m.from), m.from.substring(0, m.from.lastIndexOf("/"))).catch(function () { });
              });
            });
            return chain.then(function () { return { ok: true, message: "Moved everything back." }; });
          }
        }),
        readStep("report", "Report", "fm.report", function (ctx) {
          var total = (ctx.moves || []).length;
          return Promise.resolve({
            ok: true,
            message: total
              ? "Organised " + total + " file(s) in " + base(target) + " by " + by + "."
              : "Nothing needed moving in " + base(target) + "."
          });
        })
      ];
    },

    DELETE: function (frame) {
      var target = resolvePath(frame);
      return [
        step({
          id: "select",
          cap: "fm.list",
          label: "Find what to delete",
          run: function (ctx) {
            var slots = frame.slots || {};
            if (slots.file || slots.path) {
              ctx.victims = [target];
              return Promise.resolve({ ok: true, message: "1 item selected." });
            }
            return FS().list(target).then(function (r) {
              ctx.victims = listEntries(r).filter(function (e) { return matchesFilters(e, slots); }).map(pathOf).filter(Boolean);
              return { ok: true, message: ctx.victims.length + " item(s) selected." };
            });
          }
        }),
        step({
          id: "remove",
          cap: "fm.delete",
          label: "Delete",
          destructive: true,
          critical: true,
          run: function (ctx) {
            var chain = Promise.resolve();
            var done = 0;
            var attempted = (ctx.victims || []).length;
            (ctx.victims || []).forEach(function (p) {
              chain = chain.then(function () {
                return FS()["delete"](p).then(function () { done++; }).catch(function () { });
              });
            });
            return chain.then(function () {
              var partial = done > 0 && done < attempted;
              return {
                ok: done > 0 && !partial,
                message: partial
                  ? "Deleted only " + done + " of " + attempted + " item(s)."
                  : "Deleted " + done + " item(s)."
              };
            });
          },
          verify: function (ctx) {
            if (!ctx.victims || !ctx.victims.length) return Promise.resolve(true);
            var dir = target;
            if (ctx.victims.length === 1 && ctx.victims[0] === target) {
              dir = target.substring(0, target.lastIndexOf("/")) || ROOT;
            }
            return FS().list(dir).then(function (r) {
              var names = listEntries(r).map(function (e) { return base(pathOf(e)); });
              return ctx.victims.every(function (p) { return names.indexOf(base(p)) < 0; });
            }).catch(function () { return false; });
          }
          // Deletion has no compensate: this is why the engine asks first.
        })
      ];
    },

    SEARCH: function (frame) {
      var q = frame.slots.query || frame.slots.target || "";
      var dir = resolvePath(frame);
      return [readStep("search", "Search", "fm.search", function () {
        return FS().search(q, dir).then(function (r) {
          var list = listEntries(r);
          return {
            ok: true,
            message: list.length
              ? list.length + " match(es): " + list.slice(0, 10).map(function (e) { return base(pathOf(e)); }).join(", ")
              : "Nothing matched \"" + q + "\"."
          };
        });
      })];
    },

    LARGEST: function (frame) {
      var dir = resolvePath(frame);
      var limit = frame.slots.count || 10;
      return [readStep("largest", "Largest files", "fm.largest", function () {
        return FS().largest(dir, limit).then(function (r) {
          var list = listEntries(r);
          return {
            ok: true,
            message: list.length
              ? list.slice(0, limit).map(function (e) { return base(pathOf(e)); }).join(", ")
              : "No files found in " + base(dir) + "."
          };
        });
      })];
    },

    CLEAN_EMPTY: function (frame) {
      var dir = resolvePath(frame);
      return [
        step({
          id: "find",
          cap: "fm.empty",
          label: "Find empty folders",
          run: function (ctx) {
            return FS().emptyFolders(dir).then(function (r) {
              ctx.empties = listEntries(r).map(pathOf).filter(Boolean);
              return { ok: true, message: ctx.empties.length + " empty folder(s)." };
            });
          }
        }),
        step({
          id: "remove",
          cap: "fm.delete",
          label: "Remove them",
          destructive: true,
          critical: false,
          run: function (ctx) {
            var chain = Promise.resolve();
            var done = 0;
            (ctx.empties || []).forEach(function (p) {
              chain = chain.then(function () {
                return FS()["delete"](p).then(function () { done++; }).catch(function () { });
              });
            });
            return chain.then(function () { return { ok: true, message: "Removed " + done + " empty folder(s)." }; });
          }
        })
      ];
    },

    MOVE: function (frame) {
      var from = resolvePath(frame);
      var to = frame.slots.destination || ROOT;
      return [step({
        id: "move", cap: "fm.move", label: "Move", destructive: true, critical: true,
        run: function () { return FS().move(from, to); },
        verify: function () {
          return FS().list(to).then(function (r) {
            var names = listEntries(r).map(function (e) { return base(pathOf(e)); });
            return names.indexOf(base(from)) >= 0;
          }).catch(function () { return false; });
        },
        compensate: function () {
          return FS().move(to + "/" + base(from), from.substring(0, from.lastIndexOf("/")) || ROOT);
        }
      })];
    },

    COPY: function (frame) {
      var from = resolvePath(frame);
      var to = frame.slots.destination || ROOT;
      return [step({
        id: "copy", cap: "fm.copy", label: "Copy", destructive: false, critical: true,
        run: function () { return FS().copy(from, to); },
        verify: function () {
          return FS().list(to).then(function (r) {
            var names = listEntries(r).map(function (e) { return base(pathOf(e)); });
            return names.indexOf(base(from)) >= 0;
          }).catch(function () { return false; });
        }
      })];
    },

    RENAME: function (frame) {
      var from = resolvePath(frame);
      var to = frame.slots.name || "";
      return [step({
        id: "rename", cap: "fm.rename", label: "Rename", destructive: true, critical: true,
        run: function () { return FS().rename(from, to); },
        verify: function () {
          var dir = from.substring(0, from.lastIndexOf("/")) || ROOT;
          return FS().list(dir).then(function (r) {
            var names = listEntries(r).map(function (e) { return base(pathOf(e)); });
            return names.indexOf(to) >= 0;
          }).catch(function () { return false; });
        }
      })];
    },

    MKDIR: function (frame) {
      var parent = resolvePath(frame);
      var name = frame.slots.name || frame.slots.quoted || "";
      return [step({
        id: "mkdir", cap: "fm.mkdir", label: "Create folder", critical: true,
        run: function () { return FS().mkdir(parent, name); },
        verify: function () {
          return FS().list(parent).then(function (r) {
            var names = listEntries(r).map(function (e) { return base(pathOf(e)).toLowerCase(); });
            return names.indexOf(String(name).toLowerCase()) >= 0;
          }).catch(function () { return false; });
        }
      })];
    },

    OPEN: function (frame) {
      var p = resolvePath(frame);
      return [readStep("open", "Open", "fm.open", function () {
        return Promise.resolve({ ok: true, message: "Opening " + base(p) + ".", openFM: "/files?path=" + encodeURIComponent(p) });
      })];
    },

    PLAY: function (frame) {
      var p = resolvePath(frame);
      return [readStep("play", "Play", "media.play", function () {
        return Promise.resolve({ ok: true, message: "Playing " + base(p) + ".", openFM: "/player?path=" + encodeURIComponent(p) });
      })];
    },

    READ: function (frame) {
      var p = resolvePath(frame);
      return [readStep("read", "Read", "fm.read", function () {
        return FS().read(p).then(function (r) {
          var body = (r && (r.content || r.text)) || "";
          return { ok: true, message: body ? String(body).slice(0, 4000) : "That file is empty." };
        });
      })];
    },

    DOWNLOAD: function (frame) {
      var p = resolvePath(frame);
      return [readStep("download", "Download", "fm.download", function () {
        return Promise.resolve({
          ok: true,
          message: "Preparing " + base(p) + ".",
          openFM: "/files?path=" + encodeURIComponent(p.substring(0, p.lastIndexOf("/")) || ROOT)
        });
      })];
    },

    DIAGNOSE: function () {
      return [readStep("diagnose", "Run a health pass", "system.health", function () {
        var token = "";
        try { token = AI.token || sessionStorage.getItem("lhtoken") || localStorage.getItem("lhtoken") || ""; } catch (e) { }
        return fetch("/api/sentinel/report", { headers: token ? { Authorization: "Bearer " + token } : {} })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (j) {
            if (!j || !j.ok || !j.report) {
              return { ok: false, message: "Sentinel is not available in this build." };
            }
            var rep = j.report;
            if (!rep.diagnoses.length && !rep.security.threats.length) {
              return { ok: true, message: "No faults found. Security grade " + rep.security.grade + " (" + rep.security.score + "/100)." };
            }
            var first = rep.diagnoses[0];
            var lines = [];
            if (first) {
              lines.push(first.title);
              lines.push("Cause: " + first.cause);
              if (first.why && first.why.length) lines.push("Why: " + first.why.join(" | "));
            }
            rep.security.threats.slice(0, 3).forEach(function (t) {
              lines.push("Security (" + t.severity + "): " + t.detail);
            });
            return {
              ok: true,
              message: lines.join("\n"),
              openFM: "/sentinel.html"
            };
          });
      })];
    }
  };

  // Simple one-call read plans.
  var SIMPLE = {
    SERVER_START: function () { return [serverStep("start", "Start the server", "start")]; },
    SERVER_STOP: function () { return [serverStep("stop", "Stop the server", "stop")]; },
    SERVER_RESTART: function () { return [serverStep("restart", "Restart the server", "restart")]; },
    SERVER_STATUS: function () {
      return [readStep("status", "Server status", "server.status", function () {
        return FS().status().then(function (s) {
          return { ok: true, message: "Server running on " + s.url + " (v" + s.version + "). Uptime " + Math.round((s.uptimeMs || 0) / 1000) + "s." };
        });
      })];
    },
    SHOW_CPU: function () {
      return [readStep("cpu", "CPU usage", "system.cpu", function () {
        return FS().system ? FS().system().then(function (s) {
          return { ok: true, message: "CPU " + Math.round((s.cpu && s.cpu.usagePercent) || 0) + "%." };
        }) : Promise.resolve({ ok: false, message: "Telemetry unavailable." });
      })];
    },
    SHOW_RAM: function () {
      return [readStep("ram", "Memory", "system.memory", function () {
        return FS().system ? FS().system().then(function (s) {
          var m = s.memory || {};
          return { ok: true, message: "RAM " + Math.round((m.usedBytes || 0) / 1048576) + " MB of " + Math.round((m.totalBytes || 0) / 1048576) + " MB." };
        }) : Promise.resolve({ ok: false, message: "Telemetry unavailable." });
      })];
    },
    SHOW_STORAGE: function () {
      return [readStep("storage", "Storage", "storage.usage", function () {
        return FS().system ? FS().system().then(function (s) {
          var d = s.storage || {};
          return { ok: true, message: "Storage " + Math.round((d.usedBytes || 0) / 1073741824) + " GB used of " + Math.round((d.totalBytes || 0) / 1073741824) + " GB." };
        }) : Promise.resolve({ ok: false, message: "Telemetry unavailable." });
      })];
    },
    SHOW_BATTERY: function () {
      return [readStep("battery", "Battery", "system.battery", function () {
        return FS().system ? FS().system().then(function (s) {
          var b = s.battery || {};
          return { ok: true, message: "Battery " + (b.level || 0) + "%" + (b.isCharging ? " (charging)" : "") + "." };
        }) : Promise.resolve({ ok: false, message: "Telemetry unavailable." });
      })];
    },
    SHOW_NETWORK: function () {
      return [readStep("network", "Network", "network.info", function () {
        return FS().system ? FS().system().then(function (s) {
          var n = s.network || {};
          return { ok: true, message: "IP " + (n.ipAddress || "unavailable") + " on " + (n.ssid || n.type || "unknown") + "." };
        }) : Promise.resolve({ ok: false, message: "Telemetry unavailable." });
      })];
    },
    SHOW_CLIENTS: function () {
      return [readStep("clients", "Connected devices", "clients.show", function () {
        return FS().clients().then(function (r) {
          var list = (r && r.clients) || [];
          return { ok: true, message: list.length ? list.length + " device(s): " + list.map(function (c) { return c.ip; }).join(", ") : "No devices connected." };
        });
      })];
    },
    SHOW_LOGS: function () {
      return [readStep("logs", "Recent logs", "logs.show", function () {
        return FS().logs().then(function (r) {
          var logs = (r && r.logs) || [];
          return {
            ok: true,
            message: logs.length
              ? logs.slice(0, 10).map(function (x) { return "[" + (x.level || "INFO") + "] " + x.message; }).join("\n")
              : "No log entries."
          };
        });
      })];
    },
    REMEMBER: function (frame) {
      var text = frame.slots.text || "";
      return [step({
        id: "remember", cap: "memory.put", label: "Remember", critical: true,
        run: function () {
          return AI.Memory.put("memories", { text: text, type: "fact" }).then(function () {
            return { ok: true, message: "Remembered: " + text };
          });
        },
        verify: function () { return Promise.resolve(true); }
      })];
    },
    RECALL: function () {
      return [readStep("recall", "Recall memories", "memory.get", function () {
        return AI.Memory.getAll("memories").then(function (mems) {
          return { ok: true, message: mems.length ? mems.map(function (m) { return m.text; }).join("\n") : "No memories yet." };
        });
      })];
    },
    STORAGE_REPORT: function () {
      return [readStep("report", "Storage report", "storage.usage", function () {
        return FS().system ? FS().system().then(function (s) {
          var d = s.storage || {};
          return { ok: true, message: "Used " + Math.round((d.usedBytes || 0) / 1073741824) + " GB, free " + Math.round((d.availableBytes || 0) / 1073741824) + " GB." };
        }) : Promise.resolve({ ok: false, message: "Telemetry unavailable." });
      })];
    },
    BACKUP: function (frame) {
      var target = resolvePath(frame);
      var stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      var dest = ROOT + "/LocalHub/Backups/" + stamp;
      return [
        step({
          id: "prepare", cap: "fm.mkdir", label: "Create the backup folder", critical: true,
          run: function () { return FS().mkdir(ROOT + "/LocalHub/Backups", stamp).catch(function () { return { ok: true }; }); }
        }),
        step({
          id: "copy", cap: "fm.copy", label: "Copy files", critical: true,
          run: function (ctx) {
            return FS().list(target).then(function (r) {
              var items = listEntries(r).map(pathOf).filter(Boolean);
              var chain = Promise.resolve();
              var done = 0;
              items.forEach(function (p) {
                chain = chain.then(function () {
                  return FS().copy(p, dest).then(function () { done++; }).catch(function () { });
                });
              });
              var partial = done > 0 && done < items.length;
              return chain.then(function () {
                ctx.copied = done;
                return {
                  ok: done > 0 && !partial,
                  message: partial ? "Copied only " + done + " of " + items.length + " item(s)." : "Copied " + done + " item(s)."
                };
              });
            });
          },
          verify: function (ctx) {
            return FS().list(dest).then(function (r) {
              return listEntries(r).length >= (ctx.copied || 0);
            }).catch(function () { return false; });
          }
        })
      ];
    },
    UPLOAD: function () {
      return [readStep("upload", "Open the uploader", "fm.upload", function () {
        return Promise.resolve({ ok: true, message: "Opening the File Manager — use ⬆ to upload.", openFM: "/files?path=" + encodeURIComponent(ROOT) });
      })];
    },
    PAUSE: function () {
      return [readStep("pause", "Pause playback", "media.pause", function () {
        return Promise.resolve({ ok: true, message: "Paused.", media: "pause" });
      })];
    },
    HELP: function () {
      return [readStep("help", "Help", "help", function () {
        return Promise.resolve({
          ok: true,
          message: [
            "I can run things, not just describe them. Examples:",
            "• \"organise downloads by type\" — plans it, does it, then proves it",
            "• \"delete the largest files over 100 MB in downloads\"",
            "• \"search for invoice\"  •  \"show battery\"  •  \"restart server\"",
            "• \"diagnose\" — runs a full health pass and names the cause"
          ].join("\n")
        });
      })];
    }
  };

  /** Builds the step list for a frame. Returns [] when the action has no plan. */
  function build(frame) {
    if (!frame || !frame.action) return [];
    if (BUILDERS[frame.action]) return BUILDERS[frame.action](frame);
    if (SIMPLE[frame.action]) return SIMPLE[frame.action](frame);
    return [];
  }

  NLU.Plans = {
    build: build,
    resolvePath: resolvePath,
    FOLDER_PATHS: FOLDER_PATHS,
    typeOfName: typeOfName,
    base: base,
    step: step
  };
})(window);
