/* assistant.js - natural-language intent parsing and skill execution. */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  var FS = global.LH_AI.FS;
  var Memory = global.LH_AI.Memory;
  var Commands = global.LH_AI.Commands;

  var ROOT = "/storage/emulated/0";

  // Intents (most specific first).
  var intents = [
    { re: /(?:open|show|list)\s+(?:the\s+)?(downloads?|pictures?|dcim|camera|documents?|movies?|music|download\s+folder)/i, intent: "openSpecialFolder" },
    { re: /(?:largest|biggest|big)\s+files/i, intent: "largestFiles" },
    { re: /empty\s+folder/i, intent: "emptyFolders" },
    { re: /(?:preview|view|show)\s+(?:image|photo|picture|the\s+image)/i, intent: "preview" },
    { re: /(?:play|watch|open)\s+(?:video|movie|the\s+video)/i, intent: "preview" },
    { re: /(?:play|listen|open)\s+(?:music|audio|song|the\s+audio)/i, intent: "preview" },
    { re: /(?:open|view|show)\s+(?:pdf|the\s+pdf)/i, intent: "preview" },
    { re: /(?:delete|remove|trash)\s+.*\b(file|folder|it)\b/i, intent: "delete" },
    { re: /rename\s+/i, intent: "rename" },
    { re: /(?:create|make|new)\s+(?:folder|directory)/i, intent: "mkdir" },
    { re: /(?:search|find)\s+/i, intent: "search" },
    { re: /(?:read|open)\s+file/i, intent: "readFile" },
    { re: /(?:list|open|show|browse)\s+(?:the\s+)?folder/i, intent: "listFolder" },
    { re: /(?:write|create|new)\s+note/i, intent: "note" },
    { re: /(?:disk|storage|usage|space)/i, intent: "usage" },
    { re: /(?:server|status|uptime)/i, intent: "serverStatus" },
    { re: /(?:clients|devices|connected)/i, intent: "clients" },
    { re: /(?:logs?|log\s+entries)/i, intent: "logs" },
    { re: /(?:remember|store)\s+(?:that\s+)?/i, intent: "remember" },
    { re: /(?:what.*remember|my.*memories|list.*memor)/i, intent: "listMemories" },
    { re: /(?:organize|organise)\s+downloads/i, intent: "organizeDownloads" },
    { re: /(?:backup|back\s?up)/i, intent: "backup" },
    { re: /(?:report|disk report)/i, intent: "storageReport" },
    { re: /(?:download|get|grab)\s+(?:this\s+)?(?:file|folder)/i, intent: "download" },
    { re: /(?:show|view|see)\s+(?:my\s+)?(?:downloads|transfers)/i, intent: "showDownloads" },
    { re: /(?:cancel|stop|abort)\s+(?:the\s+)?upload/i, intent: "uploadManage" },
    { re: /(?:retry|resume)\s+upload/i, intent: "uploadManage" },
    { re: /(?:show|check)\s+upload\s+(?:progress|status)/i, intent: "uploadManage" },
    { re: /(?:upload|push)\s+(?:this\s+)?(?:file|image|picture|these\s+images)/i, intent: "upload" }
  ];

  var SPECIAL = {
    downloads: ROOT + "/Download", download: ROOT + "/Download",
    pictures: ROOT + "/Pictures", picture: ROOT + "/Pictures",
    dcim: ROOT + "/DCIM", camera: ROOT + "/DCIM/Camera",
    documents: ROOT + "/Documents", document: ROOT + "/Documents",
    movies: ROOT + "/Movies", movie: ROOT + "/Movies",
    music: ROOT + "/Music"
  };

  function absolutePath(text) {
    var m = text.match(/(\/[\w\s\-\.]+)+(?:\/[\w\s\-\.]+)?/g);
    return m ? m[m.length - 1].replace(/\.$/, "").trim() : null;
  }

  function extension(name) { var i = name.lastIndexOf('.'); return i < 0 ? "" : name.substring(i + 1).toLowerCase(); }

  /** Resolves a target file/folder from user text (absolute path or name in [dir]). */
  async function resolveTarget(text, dir) {
    var abs = absolutePath(text);
    if (abs) return abs;
    var m = text.match(/["']?([\w\s\-\.]+\.(?:pdf|png|jpe?g|gif|webp|mp4|mkv|avi|webm|mp3|wav|ogg|m4a|flac|txt|zip|apk))["']?/i);
    if (m) {
      var name = m[1];
      var res = await FS.search(name, dir);
      var hit = (res.matches || []).find(function (h) { return h.name === name; });
      if (hit) return hit.path;
    }
    return null;
  }

  /** Classifies a path from its extension. Returns category or null. */
  function categoryOf(path) {
    var e = extension(path);
    if (/^(jpg|jpeg|png|webp|gif|bmp|svg)$/.test(e)) return "image";
    if (/^(mp4|mkv|avi|webm|mov)$/.test(e)) return "video";
    if (/^(mp3|wav|ogg|oga|m4a|flac|aac)$/.test(e)) return "audio";
    if (e === "pdf") return "pdf";
    if (/^(txt|md|log|json|xml|html|css|js|kt|java|py|sh|csv)$/.test(e)) return "text";
    if (/^(zip|apk)$/.test(e)) return "archive";
    return "binary";
  }

  var Assistant = {
    parse: function (text) {
      // First try the OS command engine (rule-based, synonym-tolerant).
      var cmd = Commands && Commands.parse(text);
      if (cmd) return { intent: cmd.command.name, text: text, command: cmd };
      for (var i = 0; i < intents.length; i++) {
        if (intents[i].re.test(text)) return { intent: intents[i].intent, text: text };
      }
      return { intent: "chat", text: text };
    },

    run: async function (intent, text, parsed) {
      // If this came from the command engine, execute it there.
      if (parsed && parsed.command) {
        var res = await Commands.execute(parsed);
        return res;
      }
      var dir = absolutePath(text) || ROOT;
      switch (intent) {

        case "openSpecialFolder": {
          var m = text.toLowerCase().match(/(downloads?|pictures?|dcim|camera|documents?|movies?|music)/);
          var p = SPECIAL[m && m[1]] || ROOT;
          return { ok: true, message: "Opening " + p + " in the File Manager.", openFM: "/files?path=" + encodeURIComponent(p) };
        }

        case "listFolder": {
          var d = await FS.list(dir);
          var f = (d.folders || []).map(function (x) { return x.name; });
          return { ok: true, message: "Folder " + d.path + " has " + (f.length ? f.join(", ") : "(no sub-folders)") + ".", openFM: "/files?path=" + encodeURIComponent(dir) };
        }

        case "preview": {
          var target = await resolveTarget(text, ROOT);
          if (!target) return { ok: false, message: "Which file should I preview? Give me a filename or path." };
          var cat = categoryOf(target);
          if (cat === "text") {
            var r = await FS.read(target);
            return { ok: true, message: "📄 " + target + ":\n" + (r.ok ? r.content : "(cannot read)"), data: r };
          }
          if (cat === "image" || cat === "video" || cat === "audio" || cat === "pdf") {
            return { ok: true, message: "Opening preview for " + target, openFM: "/files?path=" + encodeURIComponent(target.substring(0, target.lastIndexOf("/"))) + "&preview=" + encodeURIComponent(target) };
          }
          return { ok: true, message: "Opening " + target + " (binary).", openFM: "/files?path=" + encodeURIComponent(target.substring(0, target.lastIndexOf("/"))) + "&preview=" + encodeURIComponent(target) };
        }

        case "readFile": {
          var target = await resolveTarget(text, ROOT);
          if (!target) return { ok: false, message: "Which file should I read?" };
          var cat = categoryOf(target);
          // Never render binary bytes in chat.
          if (cat !== "text") {
            return { ok: true, message: "That's a " + cat + " file — I won't dump raw bytes. Opening the viewer instead.", openFM: "/files?path=" + encodeURIComponent(target.substring(0, target.lastIndexOf("/"))) + "&preview=" + encodeURIComponent(target) };
          }
          var r = await FS.read(target);
          return { ok: r.ok, message: r.ok ? "📄 " + target + ":\n" + r.content : "Cannot read " + target, data: r };
        }

        case "search": {
          var m = text.match(/(?:search|find)\s+(?:for\s+)?["']?(?:image\s+named\s+|files?\s+(?:named|for)\s+|for\s+)?([^"']+)/i);
          var q = (m ? m[1] : text).trim();
          var r = await FS.search(q, ROOT);
          var hits = (r.matches || []).slice(0, 25);
          return { ok: true, message: hits.length ? "Found " + hits.length + ":\n" + hits.map(function (h) { return h.path; }).join("\n") : "No matches for '" + q + "'.", data: hits };
        }

        case "delete": {
          var target = await resolveTarget(text, ROOT);
          if (!target) return { ok: false, message: "What should I delete? Give me a file or folder path." };
          if (!confirm("Delete \"" + target.split("/").pop() + "\"? This cannot be undone.")) {
            return { ok: false, message: "Deletion cancelled." };
          }
          var r = await FS.delete(target);
          return { ok: r.ok, message: r.ok ? "Deleted " + target : (r.error || "delete failed"), data: r };
        }

        case "rename": {
          var abs = absolutePath(text);
          var name = text.match(/rename\s+([\w\s\-\.]+\.(?:pdf|png|jpe?g|gif|txt|zip|apk|mp4|mp3))\s+(?:to|as)\s+([\w\s\-\.]+)/i);
          if (!abs && !name) return { ok: false, message: "Tell me what to rename. Try: rename abc.pdf to newname.pdf" };
          var target = abs || (await resolveTarget(text, ROOT));
          if (!target) return { ok: false, message: "Could not find the file to rename." };
          var newName = (name && name[2]) || (name && name[1]) || prompt("New name:", target.split("/").pop());
          if (!newName) return { ok: false, message: "Rename cancelled." };
          var r = await FS.rename(target, newName);
          return { ok: r.ok, message: r.ok ? "Renamed to " + r.path : (r.error || "rename failed"), data: r };
        }

        case "mkdir": {
          var nm = text.match(/(?:folder|directory)\s+["']?([\w\s\-]+)/i);
          var name = nm ? nm[1].trim() : "NewFolder";
          var r = await FS.mkdir(dir, name);
          return { ok: r.ok, message: r.ok ? "Created folder " + r.path : (r.error || "create failed"), data: r };
        }

        case "largestFiles": {
          var res = await FS.largest(ROOT, 15);
          if (!res.ok) return { ok: false, message: res.error || "failed" };
          var gb = 1073741824;
          return { ok: true, message: "Largest files:\n" + (res.items || []).map(function (x) { return fmtSize(x.size) + "  " + x.path; }).join("\n"), data: res };
        }

        case "emptyFolders": {
          var res = await FS.emptyFolders(ROOT);
          if (!res.ok) return { ok: false, message: res.error || "failed" };
          return { ok: true, message: (res.items || []).length ? "Empty folders:\n" + res.items.slice(0, 25).join("\n") : "No empty folders found.", data: res };
        }

        case "note": {
          var nm = text.match(/(?:note)\s+["']?([^"']+)/i);
          var title = nm ? nm[1].trim() : "note-" + Date.now();
          var r = await FS.write(ROOT + "/Download/" + title + ".txt", text + "\n");
          return { ok: r.ok, message: r.ok ? "Note saved: " + r.path : r.error, data: r };
        }

        case "usage": {
          var u = await FS.usage();
          var gb = 1073741824;
          return { ok: true, message: "Storage used " + (u.usedBytes / gb).toFixed(1) + " GB of " + (u.totalBytes / gb).toFixed(1) + " GB", data: u };
        }

        case "serverStatus": {
          var st = await FS.status();
          return { ok: true, message: "Server running on " + st.url + " (v" + st.version + ")", data: st };
        }

        case "clients": {
          var c = await FS.clients();
          var list = c.clients || [];
          return { ok: true, message: list.length ? list.map(function (x) { return x.ip; }).join(", ") : "No clients connected", data: list };
        }

        case "logs": {
          var l = await FS.logs();
          var logs = l.logs || [];
          return { ok: true, message: logs.slice(0, 10).map(function (x) { return "[" + (x.level || "INFO") + "] " + x.message; }).join("\n"), data: logs };
        }

        case "remember": {
          var mm = text.replace(/^.*remember\s+(that\s+)?/i, "").trim();
          if (!mm) return { ok: false, message: "Nothing to remember." };
          await Memory.put("memories", { text: mm, type: "fact" });
          return { ok: true, message: "Remembered: " + mm };
        }

        case "listMemories": {
          var mems = await Memory.getAll("memories");
          return { ok: true, message: mems.length ? mems.map(function (x) { return x.text; }).join("\n") : "No memories yet." };
        }

        case "download": {
          var target = await resolveTarget(text, ROOT);
          if (!target) return { ok: false, message: "Which file or folder should I download?" };
          return { ok: true, message: "Preparing download for " + baseName(target) + ".", openFM: "/files?path=" + encodeURIComponent(target.substring(0, target.lastIndexOf("/"))) };
        }
        case "showDownloads":
          return { ok: true, message: "Opening the transfer manager so you can watch downloads and uploads.", openFM: "/files?transfers=1" };
        case "uploadManage":
          return { ok: true, message: "Opening the transfer manager to manage uploads (cancel / retry / progress).", openFM: "/files?transfers=1" };
        case "upload":
          return { ok: true, message: "I can't accept file drops here, but I've opened the File Manager — use the ⬆ button or drag files into it to upload to the current folder.", openFM: "/files?path=" + encodeURIComponent(ROOT) };

        case "organizeDownloads": case "backup": case "deleteEmptyFolders": case "storageReport":
          return { ok: true, message: "Planner ready for '" + intent + "'. Use the Automation tab to run the workflow.", intent: intent };

        default: {
          // No intent matched; let the command engine try (handles guardrail too).
          var fallback = Commands && Commands.parse(text);
          if (fallback) return Commands.execute(fallback);
          return { ok: true, message: "I'm the LocalHub operating system assistant. I control LocalHub — try 'open downloads', 'show cpu usage', 'restart server', or 'search files named <query>'." };
        }
      }
    }
  };

  function fmtSize(b) { b = b || 0; var u=["B","KB","MB","GB","TB"],i=0; while(b>=1024&&i<u.length-1){b/=1024;i++;} return b.toFixed(b>=10||i===0?0:1)+" "+u[i]; }
  function baseName(p) { return String(p||"").split("/").pop() || p; }

  global.LH_AI.Assistant = Assistant;
})(window);
