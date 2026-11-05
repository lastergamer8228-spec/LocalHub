/* understand.js - turns a sentence into a frame.
 *
 * A frame is the smallest complete description of a request:
 *   { action, slots, modifiers, confidence, coverage }
 *
 * Two things make this different from the pattern list it replaces.
 *
 * 1. Coverage. The parser records which words it accounted for and scores
 *    itself on how much of the sentence that was. "Delete the ten largest
 *    files in downloads" consumes almost all of its words under DELETE, so it
 *    scores high. "What is your limit" consumes almost none under any action,
 *    so every action scores low and the engine falls back instead of guessing.
 *    That single property removes the whole class of bugs where an unrelated
 *    knowledge entry won because its pattern was long.
 *
 * 2. Slots. Values are extracted once, here, and handed to the plan as typed
 *    arguments. Commands no longer re-parse the raw sentence themselves, so
 *    the same slot feeds listing, planning, verification and the confirmation
 *    message.
 */
(function (global) {
  "use strict";

  var AI = global.LH_AI = global.LH_AI || {};
  var NLU = AI.NLU = AI.NLU || {};
  var L = NLU.Lexicon;

  var ROOT = "/storage/emulated/0";

  // Which slot values can stand in for "the thing this acts on".
  var TARGET_SLOTS = ["path", "file", "quoted", "folder", "type", "query"];

  /**
   * Frame grammar. `requires` lists slots that must be filled for the frame to
   * be usable; a request missing one produces a clarification, never a guess.
   */
  var FRAMES = [
    { action: "DELETE", requires: ["target"], accepts: ["folder", "type", "size", "time", "query"], destructive: true, base: 0.9 },
    { action: "MOVE", requires: ["target", "destination"], accepts: ["folder", "file"], destructive: false, base: 0.9 },
    { action: "COPY", requires: ["target", "destination"], accepts: ["folder", "file"], destructive: false, base: 0.9 },
    { action: "RENAME", requires: ["target", "name"], accepts: ["file", "folder"], destructive: false, base: 0.9 },
    { action: "MKDIR", requires: ["name"], accepts: ["folder"], destructive: false, base: 0.9 },
    { action: "SEARCH", requires: ["query"], accepts: ["type", "folder", "time", "size"], destructive: false, base: 0.85 },
    { action: "LARGEST", requires: [], accepts: ["folder", "type", "count"], destructive: false, base: 0.9 },
    { action: "CLEAN_EMPTY", requires: [], accepts: ["folder"], destructive: true, base: 0.9 },
    { action: "ORGANIZE", requires: ["target"], accepts: ["folder", "by"], destructive: false, base: 0.9 },
    { action: "BACKUP", requires: ["target"], accepts: ["folder"], destructive: false, base: 0.85 },
    { action: "STORAGE_REPORT", requires: [], accepts: [], destructive: false, base: 0.9 },
    { action: "OPEN", requires: ["target"], accepts: ["folder", "type"], destructive: false, base: 0.8 },
    { action: "PLAY", requires: ["target"], accepts: ["folder", "type", "query"], destructive: false, base: 0.85 },
    { action: "READ", requires: ["target"], accepts: ["file", "type"], destructive: false, base: 0.85 },
    { action: "DOWNLOAD", requires: ["target"], accepts: ["file", "folder"], destructive: false, base: 0.85 },
    { action: "UPLOAD", requires: [], accepts: [], destructive: false, base: 0.8 },
    { action: "SERVER_START", requires: [], accepts: [], destructive: false, base: 0.95 },
    { action: "SERVER_STOP", requires: [], accepts: [], destructive: false, base: 0.95 },
    { action: "SERVER_RESTART", requires: [], accepts: [], destructive: false, base: 0.95 },
    { action: "SERVER_STATUS", requires: [], accepts: [], destructive: false, base: 0.9 },
    { action: "SHOW_CPU", requires: [], accepts: [], destructive: false, base: 0.9 },
    { action: "SHOW_RAM", requires: [], accepts: [], destructive: false, base: 0.9 },
    { action: "SHOW_STORAGE", requires: [], accepts: [], destructive: false, base: 0.9 },
    { action: "SHOW_BATTERY", requires: [], accepts: [], destructive: false, base: 0.9 },
    { action: "SHOW_NETWORK", requires: [], accepts: [], destructive: false, base: 0.9 },
    { action: "SHOW_CLIENTS", requires: [], accepts: [], destructive: false, base: 0.9 },
    { action: "SHOW_LOGS", requires: [], accepts: [], destructive: false, base: 0.9 },
    { action: "REMEMBER", requires: ["text"], accepts: [], destructive: false, base: 0.9 },
    { action: "RECALL", requires: [], accepts: [], destructive: false, base: 0.9 },
    { action: "DIAGNOSE", requires: [], accepts: [], destructive: false, base: 0.95 },
    { action: "HELP", requires: [], accepts: [], destructive: false, base: 0.9 },
    { action: "CANCEL", requires: [], accepts: [], destructive: false, base: 0.95 },
    { action: "CONFIRM", requires: [], accepts: [], destructive: false, base: 0.95 },
    { action: "PAUSE", requires: [], accepts: [], destructive: false, base: 0.9 }
  ];

  function normalize(text) {
    return String(text || "").trim()
      .replace(/\s+/g, " ")
      .replace(/^(?:(?:please|can you|could you|would you|kindly)\s+)+/i, "")
      .replace(/\s+please[?!.]*$/i, "")
      .replace(/[?!.]+$/, "");
  }

  // ------------------------------------------------------------------ slots

  function extractSlots(text, mask, targetOrder) {
    var order = targetOrder || TARGET_SLOTS;
    var raw = String(text || "");
    var lower = raw.toLowerCase();

    // Action phrases are removed before slot extraction. Without this the
    // filename pattern swallows the verb: "move report.pdf" yielded a file
    // literally called "move report.pdf".
    (mask || []).forEach(function (span) {
      var blank = new Array(span[1] - span[0] + 1).join(" ");
      raw = raw.substring(0, span[0]) + blank + raw.substring(span[1]);
    });
    lower = raw.toLowerCase();
    var slots = {};
    var consumed = [];

    function take(span) {
      if (span) consumed.push(String(span).toLowerCase());
    }

    // Explicit path: /storage/... or /Download/Foo
    var pathMatch = raw.match(/(\/[\w\s.\-]+(?:\/[\w\s.\-]+)*)/);
    if (pathMatch && pathMatch[1].indexOf("/") === 0 && pathMatch[1].length > 2) {
      slots.path = pathMatch[1].trim().replace(/\s+$/, "");
      take(pathMatch[1]);
    }

    // Quoted literal: "holiday photos"
    var quoted = raw.match(/["']([^"']{1,120})["']/);
    if (quoted) { slots.quoted = quoted[1].trim(); take(quoted[0]); }

    // A concrete file name: report.pdf, clip.mp4
    var fileMatch = raw.match(/([\w\s.\-]+\.(?:pdf|txt|md|json|mp4|mkv|webm|avi|mp3|wav|m4a|flac|png|jpe?g|gif|webp|zip|apk))/i);
    if (fileMatch) { slots.file = fileMatch[1].trim(); take(fileMatch[1]); }

    // Well-known folder
    Object.keys(L.FOLDERS).forEach(function (key) {
      if (slots.folder) return;
      for (var i = 0; i < L.FOLDERS[key].length; i++) {
        var form = L.FOLDERS[key][i];
        if (new RegExp("(^|\\s)" + form + "(\\s|$)", "i").test(lower)) {
          slots.folder = key; take(form); break;
        }
      }
    });

    // File type
    Object.keys(L.FILE_TYPES).forEach(function (key) {
      if (slots.type) return;
      for (var i = 0; i < L.FILE_TYPES[key].length; i++) {
        var form = L.FILE_TYPES[key][i];
        if (new RegExp("(^|\\s)" + form + "s?(\\s|$)", "i").test(lower)) {
          slots.type = key; take(form); break;
        }
      }
    });

    // Size threshold: bigger than 100 MB, over 1gb
    var sizeMatch = lower.match(/(?:bigger than|larger than|over|above|greater than|more than|at least)\s+(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?/);
    if (sizeMatch) {
      slots.size = {
        value: parseFloat(sizeMatch[1]),
        unit: (sizeMatch[2] || "mb").toUpperCase(),
        comparison: "gt"
      };
      take(sizeMatch[0]);
    }

    // Count: top 5, first 3, ten largest
    var countMatch = lower.match(/\b(?:top|first|last|latest)\s+(\d{1,3})\b/) ||
                     lower.match(/\b(\d{1,3})\s+(?:files|items|results)\b/);
    if (countMatch) { slots.count = parseInt(countMatch[1], 10); take(countMatch[0]); }

    // Relative time
    Object.keys(L.TIME_WORDS).forEach(function (key) {
      if (slots.time) return;
      for (var i = 0; i < L.TIME_WORDS[key].length; i++) {
        var form = L.TIME_WORDS[key][i];
        if (new RegExp("(^|\\s)" + form + "(\\s|$)", "i").test(lower)) {
          slots.time = key; take(form); break;
        }
      }
    });

    // Destination after "to"/"into"
    var destMatch = raw.match(/\b(?:to|into)\s+(?:the\s+)?([\w\s.\/\-]{2,60})$/i);
    if (destMatch && !/^(play|pause)$/i.test(destMatch[1])) {
      slots.destination = destMatch[1].trim();
      take(destMatch[0]);
    }

    // New name after "rename X to Y" / "to Y"
    var nameMatch = raw.match(/\b(?:to|as)\s+["']?([^"']{1,60})["']?\s*$/i);
    if (nameMatch && !slots.destination) {
      slots.name = nameMatch[1].trim();
    }

    // Free-text query after an explicit introducer
    var qMatch = raw.match(/\b(?:named|called|search for|search|find|look for|matching|containing)\s+(.+)$/i);
    if (qMatch) {
      slots.query = qMatch[1].trim().replace(/[?!.]+$/, "");
      take(qMatch[0]);
    }

    // Leftover content is the query. "find my holiday photos" loses its
    // introducer to the action mask, so the remainder is the only place the
    // actual search term survives.
    if (!slots.query) {
      var leftover = leftoverText(raw, consumed);
      if (leftover && leftover.split(/\s+/).length >= 1) {
        slots.query = leftover;
        take(leftover);   // the query IS accounted for - it is the argument
      }
    }

    // "target" is whichever concrete reference we actually got, checked in the
    // order that suits the action: a search cares about its query, a delete
    // cares about the path.
    for (var t = 0; t < order.length; t++) {
      if (slots[order[t]]) { slots.target = slots[order[t]]; slots.targetKind = order[t]; break; }
    }

    slots._consumed = consumed;
    return slots;
  }

  /** Words in the text that no slot claimed. */
  function leftoverText(raw, consumed) {
    var text = String(raw || "").toLowerCase();
    consumed.forEach(function (span) { text = text.split(span).join(" "); });
    return text
      .replace(/[^a-z0-9\s/._-]/g, " ")
      .split(/\s+/)
      .filter(function (w) { return w && !L.STOPWORDS[w] && w.length > 1; })
      .join(" ")
      .trim();
  }

  // ----------------------------------------------------------------- frames

  function wordCount(s) {
    return String(s || "").split(/\s+/).filter(function (w) { return w; }).length;
  }

  /**
   * Builds candidate frames and scores them.
   *
   * score = base * actionWeight * coverage, where coverage is the share of
   * content words the frame accounted for. An action with no required slots
   * ("show battery") gets full coverage from the action phrase alone.
   */
  /** Which slot should win as the target, per action. Search cares about its
   *  query; delete cares about the path; organise cares about the folder. */
  var TARGET_ORDER = {
    SEARCH: ["query", "type", "file", "path", "folder", "quoted"],
    ORGANIZE: ["folder", "path", "type", "query", "file"],
    DELETE: ["path", "file", "folder", "type", "query"],
    OPEN: ["folder", "path", "type", "file", "query"],
    PLAY: ["path", "file", "type", "folder", "query"],
    READ: ["file", "path", "type", "folder", "query"],
    MOVE: ["file", "path", "folder", "type", "query"],
    COPY: ["file", "path", "folder", "type", "query"],
    RENAME: ["file", "path", "folder", "type", "query"],
    DOWNLOAD: ["file", "path", "folder", "type", "query"]
  };

  function frameSpec(action) {
    for (var i = 0; i < FRAMES.length; i++) if (FRAMES[i].action === action) return FRAMES[i];
    return null;
  }

  /**
   * Builds candidate frames and scores them.
   *
   * score = base x actionWeight x positionBonus x coverage
   *
   * The position bonus matters more than it looks. English imperatives put the
   * verb first, so "delete the largest files" must choose DELETE even though
   * LARGEST is the more specific-sounding concept further along the sentence.
   * Without it the engine happily "shows" what the user asked it to remove.
   */
  function frames(text) {
    var clean = normalize(text);
    if (!clean) return [];

    var actions = L.findActions(clean);
    var modifiers = L.findModifiers(clean);
    var total = L.contentWords(clean).length || 1;
    var out = [];
    var seen = {};

    actions.forEach(function (hit) {
      var spec = frameSpec(hit.key);
      if (!spec) return;
      if (seen[hit.key]) return;
      seen[hit.key] = true;

      // Slots are read from the sentence with this action's own words removed.
      var slots = extractSlots(clean, [[hit.start, hit.end]], TARGET_ORDER[hit.key] || TARGET_SLOTS);

      // A couple of slots are defined by the sentence as a whole, so they must
      // be read before masking: "remember that X" is X even though "remember"
      // is the action that got removed.
      if (hit.key === "REMEMBER") {
        slots.text = clean.replace(/^remember\s+(that\s+)?/i, "").trim();
        if (slots.text) slots._consumed.push(slots.text);
      }

      var consumed = wordCount(hit.form) +
        modifiers.reduce(function (n, m) { return n + wordCount(m.form); }, 0) +
        (slots._consumed || []).reduce(function (n, x) { return n + wordCount(x); }, 0);
      var coverage = Math.min(1, consumed / total);

      var posBonus = 1 + 0.3 * (1 - Math.min(1, hit.start / 12));

      var missing = spec.requires.filter(function (r) {
        if (r === "target") return !slots.target;
        return !slots[r];
      });

      var score = spec.base * hit.weight * posBonus * (0.45 + 0.55 * coverage);

      out.push({
        action: spec.action,
        slots: slots,
        modifiers: modifiers.map(function (m) { return m.key; }),
        missing: missing,
        destructive: !!spec.destructive,
        coverage: coverage,
        // Raw score ranks frames. Confidence is the clamped value used for the
        // accept/reject decision; ranking on the clamped value collapsed every
        // strong frame to 1.0 and let whichever action appeared first win.
        score: score,
        confidence: Math.max(0, Math.min(1, score)),
        complete: missing.length === 0,
        text: clean
      });
    });

    // No verb at all: "downloads", "movies", "/Download/Invoices".
    // Treat a bare location as a request to open it rather than a mystery.
    if (!out.length) {
      var bare = extractSlots(clean, [], TARGET_SLOTS);
      if (bare.folder || bare.path) {
        out.push({
          action: "OPEN",
          slots: bare,
          modifiers: [],
          missing: [],
          destructive: false,
          coverage: 1,
          score: 0.62,
          confidence: 0.62,
          complete: true,
          impliedVerb: true,
          text: clean
        });
      }
    }

    out.sort(function (a, b) {
      if (a.complete !== b.complete) return a.complete ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return b.confidence - a.confidence;
    });
    return out;
  }

  function best(text) {
    var list = frames(text);
    return list.length ? list[0] : null;
  }

  NLU.Understand = {
    FRAMES: FRAMES,
    TARGET_ORDER: TARGET_ORDER,
    frameSpec: frameSpec,
    TARGET_SLOTS: TARGET_SLOTS,
    ROOT: ROOT,
    normalize: normalize,
    extractSlots: extractSlots,
    frames: frames,
    best: best,
    wordCount: wordCount
  };
})(window);
