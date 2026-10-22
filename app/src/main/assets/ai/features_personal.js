/* features_personal.js - Personal Brain memory commands (v2.20). */
(function (global) {
  "use strict";
  var C = global.LH_AI.Commands;
  if (!C) return;
  var PB = global.LH_AI.Cognitive && global.LH_AI.Cognitive.PersonalBrain;
  if (!PB) return;
  function pb(fn) { return Promise.resolve(fn()); }

  // "remember this"
  C.register({ module: "personal", category: "personal", name: "remember", deep: false,
    match: [/^remember (this|that):?\s+(.+)/i, /^remember\s+(.+)/i, /^note (this|that)\s+(.+)/i, /\bkeep in mind\b/i],
    admin: false, run: function (text) {
      var content = String(text).replace(/^remember\s*(this|that)?:?\s*/i, "").replace(/^note\s*(this|that)?\s*/i, "").trim();
      if (!content) return { ok: true, message: "What should I remember? e.g. 'remember this: user prefers subtitles on'." };
      return pb(function () {
        return PB.remember("episodic", content, { explicit: true, source: "user" }).then(function (r) {
          return { ok: r.ok !== false, message: r.ok !== false ? "✅ Remembered: " + content : "Memory is disabled or unavailable." };
        });
      });
    } });

  // "remember preference" / explicit preference statement
  C.register({ module: "personal", category: "personal", name: "remember-pref", deep: false,
    match: [/\b(prefer|preference|always|never|usually|typically)\b.+(subtitles|dark|light|theme|short|detailed|voice|notifications|automation)/i],
    admin: false, run: function (text) {
      var content = String(text);
      var category = /subtitles|media|player/i.test(content) ? "media" : /dark|light|theme|ui/i.test(content) ? "ui" : /short|detailed|voice|notification/i.test(content) ? "communication" : "workflow";
      var key = /subtitles/i.test(content) ? "subtitles" : /dark/i.test(content) ? "theme" : /light/i.test(content) ? "theme" : /short/i.test(content) ? "response" : /detailed/i.test(content) ? "response" : /voice/i.test(content) ? "voice" : "custom";
      var value = /subtitles\s+(on|enabled|keep)/i.test(content) ? "on" : /dark/i.test(content) ? "dark" : /light/i.test(content) ? "light" : /short/i.test(content) ? "short" : /detailed/i.test(content) ? "detailed" : content.slice(0, 60);
      return pb(function () {
        return PB.setProfile(category, key, value).then(function (r) {
          return { ok: r.ok !== false, message: r.ok !== false ? ("✅ Preference recorded (" + category + "/" + key + " = " + value + ").") : "Could not record preference." };
        });
      });
    } });

  // "what do you remember about X"
  C.register({ module: "personal", category: "personal", name: "recall", deep: false,
    match: [/\bwhat do you (remember|know) about\b/i, /\brecall\b/i, /\bmemories about\b/i, /\bwhat have i told you\b/i],
    admin: false, run: function (text) {
      var q = String(text).replace(/what do you (remember|know) about/i, "").replace(/recall/i, "").replace(/memories about/i, "").trim();
      return pb(function () {
        return PB.recall(q, { limit: 6 }).then(function (r) {
          if (!r.length) return { ok: true, message: "I don't have any memory about '" + (q || "that") + "' yet." };
          return { ok: true, message: "📝 About '" + (q || "that") + "':\n" + r.map(function (x) { return "• [" + x.confidenceLabel + "] " + x.content; }).join("\n") };
        });
      });
    } });

  // "forget that"
  C.register({ module: "personal", category: "personal", name: "forget", deep: false,
    match: [/^forget (that|it|this)\b/i, /\bforget (this|that|about)\b/i, /^delete (that |this )?memory\b/i],
    admin: false, run: function (text) {
      var q = String(text).replace(/forget (that|it|this|about)/i, "").trim();
      return pb(function () {
        return PB.recall(q, { limit: 1 }).then(function (r) {
          if (!r.length) return { ok: true, message: "I couldn't find that memory to forget." };
          return PB.forget(r[0].id).then(function () { return { ok: true, message: "🗑️ Forgot: " + r[0].content }; });
        });
      });
    } });

  // "correct that memory"
  C.register({ module: "personal", category: "personal", name: "correct", deep: false,
    match: [/\bcorrect (that |the )?memory\b/i, /^correct\s+(.+)/i],
    admin: false, run: function (text) {
      var content = String(text).replace(/correct (that |the )?memory\b/i, "").trim();
      return pb(function () {
        return PB.recall("", { limit: 1 }).then(function (r) {
          if (!r.length || !content) return { ok: true, message: "Say 'correct that memory' after telling me the corrected fact." };
          return PB.correct(r[0].id, { content: content, importance: Math.min(10, r[0].importance + 1) }).then(function () { return { ok: true, message: "✅ Memory corrected to: " + content }; });
        });
      });
    } });

  // "show my preferences"
  C.register({ module: "personal", category: "personal", name: "prefs", deep: false,
    match: [/\bshow (my )?preferences\b/i, /\bwhat (are|is) my (preferences|profile)\b/i, /\bmy prefs\b/i],
    admin: false, run: function () {
      return pb(function () {
        return PB.getProfile().then(function (prof) {
          var lines = ["⚙️ Your preferences:"];
          Object.keys(prof).forEach(function (cat) {
            var vals = Object.keys(prof[cat]);
            if (vals.length) lines.push("• " + cat + ": " + vals.map(function (k) { return k + "=" + prof[cat][k].value; }).join(", "));
          });
          if (lines.length === 1) lines.push("(none recorded yet)");
          return { ok: true, message: lines.join("\n") };
        });
      });
    } });

  // disable / enable memory
  C.register({ module: "personal", category: "personal", name: "mem-off", deep: false,
    match: [/\b(disable|turn off|deactivate) (my )?memory\b/i, /\b(disable|turn off) memory\b/i],
    admin: false, run: function () { PB.setMemoryEnabled(false); return { ok: true, message: "🧠 Memory disabled. I'll stop storing new personal memories." }; } });
  C.register({ module: "personal", category: "personal", name: "mem-on", deep: false,
    match: [/\b(enable|turn on|activate) (my )?memory\b/i],
    admin: false, run: function () { PB.setMemoryEnabled(true); return { ok: true, message: "🧠 Memory enabled. I'll start learning again." }; } });

  // "why do you remember this"
  C.register({ module: "personal", category: "personal", name: "why-remember", deep: false,
    match: [/\bwhy do you (remember|think)\b/i, /\bwhy is that in (your )?memory\b/i],
    admin: false, run: function (text) {
      var q = String(text).replace(/why do you (remember|think)/i, "").trim();
      return pb(function () {
        return PB.recall(q, { limit: 1 }).then(function (r) {
          if (!r.length) return { ok: true, message: "I don't have a matching memory." };
          var x = r[0];
          return { ok: true, message: "🧠 I remember '" + x.content + "' because: source=" + x.source + ", importance=" + x.importance + "/10, confidence=" + x.confidenceLabel + " (" + Math.round(x.confidence * 100) + "%), stored " + new Date(x.createdAt).toLocaleDateString() + "." };
        });
      });
    } });

  // "forget everything"
  C.register({ module: "personal", category: "personal", name: "mem-clear", deep: true,
    match: [/\bforget everything\b/i, /\bclear (all )?(my )?memory\b/i, /\bwipe (my )?memory\b/i],
    admin: true, run: function () {
      return pb(function () { return PB.clearMemory().then(function () { return { ok: true, message: "🗑️ All personal memories cleared." }; }); });
    } });

  // "export memory"
  C.register({ module: "personal", category: "personal", name: "mem-export", deep: true,
    match: [/\bexport (my )?memory\b/i, /\bdownload (my )?memory\b/i],
    admin: false, run: function () {
      return pb(function () {
        return PB.exportMemory().then(function (r) { return { ok: r.ok, message: r.ok ? ("📦 Memory export: " + r.count + " entries ready locally (no cloud).") : "Export unavailable." }; });
      });
    } });
})(window);
