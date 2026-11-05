/* lexicon.js - the assistant's vocabulary.
 *
 * The engine this replaces matched an utterance against a list of regular
 * expressions and ran whichever one matched the most characters. That is why
 * "what is your limit" could match the knowledge entry for the letter "c": the
 * pattern did not have to *understand* anything, it only had to be the longest
 * thing that happened to appear.
 *
 * A lexicon works the other way round. The vocabulary is declared once, here,
 * and the parser has to account for the words the user actually used. An action
 * is only considered if its concept is present, and a concept is only present
 * if a surface form of it is in the utterance - so unrelated knowledge entries
 * cannot shadow a command, because they do not consume any of the words.
 *
 * Nothing here is executed. This file is data plus one matcher.
 */
(function (global) {
  "use strict";

  var AI = global.LH_AI = global.LH_AI || {};
  var NLU = AI.NLU = AI.NLU || {};

  // ---------------------------------------------------------------- actions
  //
  // weight: how much a hit counts. A rare, specific phrase ("clear the logs")
  // outranks a common one ("show"), so ties resolve towards intent.
  var ACTIONS = {
    OPEN: { forms: ["open", "show", "list", "browse", "go to", "navigate to", "kholo", "dikhao", "dikha do", "khol do"], weight: 1.0 },
    SEARCH: { forms: ["search", "search for", "find", "look for", "locate", "which files", "dhundho", "dhund", "khojo"], weight: 1.1 },
    PLAY: { forms: ["play", "watch", "stream", "start playing", "chalao", "play karo"], weight: 1.2 },
    PAUSE: { forms: ["pause", "stop playing", "rok do", "pause karo"], weight: 1.2 },
    DELETE: { forms: ["delete", "remove", "trash", "get rid of", "delete karo", "hata do", "uda do"], weight: 1.3 },
    RENAME: { forms: ["rename", "rename to", "change the name", "naam badlo"], weight: 1.2 },
    MOVE: { forms: ["move", "move to", "transfer", "relocate", "shift"], weight: 1.2 },
    COPY: { forms: ["copy", "copy to", "duplicate", "make a copy"], weight: 1.2 },
    MKDIR: { forms: ["create folder", "create a folder", "new folder", "make folder", "make a folder", "create directory", "naya folder"], weight: 1.3 },
    UPLOAD: { forms: ["upload", "send to phone", "put on the phone"], weight: 1.2 },
    DOWNLOAD: { forms: ["download", "get this file", "save to my device", "download karo"], weight: 1.2 },
    READ: { forms: ["read", "open file", "show contents", "cat", "padho"], weight: 1.1 },

    SERVER_START: { forms: ["start the server", "start server", "turn on the server", "server chalu karo", "start localhub"], weight: 1.5 },
    SERVER_STOP: { forms: ["stop the server", "stop server", "shut down the server", "band karo server", "stop localhub"], weight: 1.5 },
    SERVER_RESTART: { forms: ["restart the server", "restart server", "reboot the server", "restart karo"], weight: 1.5 },
    SERVER_STATUS: { forms: ["server status", "is the server running", "server uptime", "server state"], weight: 1.3 },

    SHOW_CPU: { forms: ["cpu", "cpu usage", "processor", "processor usage"], weight: 1.3 },
    SHOW_RAM: { forms: ["ram", "memory", "memory usage", "ram usage"], weight: 1.3 },
    SHOW_STORAGE: { forms: ["storage", "disk usage", "disk space", "free space", "storage usage"], weight: 1.3 },
    SHOW_BATTERY: { forms: ["battery", "battery level", "battery percentage", "charge"], weight: 1.3 },
    SHOW_NETWORK: { forms: ["network", "ip address", "ip", "my ip", "wifi", "ssid", "network info"], weight: 1.3 },
    SHOW_CLIENTS: { forms: ["clients", "connected devices", "connected clients", "who is connected"], weight: 1.3 },
    SHOW_LOGS: { forms: ["logs", "log entries", "show logs", "recent logs"], weight: 1.3 },

    REMEMBER: { forms: ["remember", "remember that", "store that", "keep this", "yaad rakho"], weight: 1.3 },
    RECALL: { forms: ["what do you remember", "my memories", "list memories", "what did i tell you", "yaad hai"], weight: 1.3 },

    ORGANIZE: { forms: ["organize", "organise", "sort out", "tidy", "arrange", "organize by"], weight: 1.5 },
    BACKUP: { forms: ["backup", "back up", "make a backup"], weight: 1.4 },
    CLEAN_EMPTY: { forms: ["empty folders", "remove empty folders", "delete empty folders", "find empty folders"], weight: 1.4 },
    STORAGE_REPORT: { forms: ["storage report", "disk report", "usage report", "space report"], weight: 1.4 },
    LARGEST: { forms: ["largest files", "biggest files", "big files", "largest", "biggest", "sabse badi files"], weight: 1.4 },

    HELP: { forms: ["help", "what can you do", "commands", "madad"], weight: 1.0 },
    CANCEL: { forms: ["cancel", "never mind", "nevermind", "stop that", "rehne do"], weight: 1.6 },
    CONFIRM: { forms: ["yes", "confirm", "proceed", "go ahead", "haan", "ha"], weight: 1.6 },

    DIAGNOSE: { forms: ["diagnose", "health check", "check health", "what is wrong", "why is it not working",
      "why is the server not working", "server not working", "not working", "isn't working", "is not working",
      "site unreachable", "unreachable", "cannot connect", "can not connect", "can't connect", "cant connect",
      "pc can't connect", "cannot open the page", "another device cannot connect",
      "scan for problems", "fix the server", "sentinel"], weight: 1.6 }
  };

  // ------------------------------------------------------------- modifiers
  //
  // Qualifiers narrow an action. They are not actions themselves.
  var MODIFIERS = {
    BY_TYPE: { forms: ["by type", "by file type", "by kind", "type ke hisaab se", "by category"], weight: 1.2 },
    BY_DATE: { forms: ["by date", "by date modified", "by time", "date ke hisaab se"], weight: 1.2 },
    BY_SIZE: { forms: ["by size", "size ke hisaab se"], weight: 1.2 },
    BY_NAME: { forms: ["by name", "alphabetically", "name ke hisaab se"], weight: 1.2 },
    RECURSIVE: { forms: ["recursively", "including subfolders", "everywhere", "in all folders"], weight: 1.1 },
    RECENT: { forms: ["recent", "latest", "newest", "last", "recently added", "aaj ke"], weight: 1.0 }
  };

  // --------------------------------------------------------------- entities

  var FOLDERS = {
    DOWNLOADS: ["downloads", "download folder", "download"],
    DCIM: ["dcim", "camera", "photos", "pictures"],
    MOVIES: ["movies", "videos", "film"],
    MUSIC: ["music", "songs", "audio folder"],
    DOCUMENTS: ["documents", "docs", "pdfs"],
    ROOT: ["root", "storage", "internal storage", "phone storage"]
  };

  var FILE_TYPES = {
    video: ["video", "videos", "movie", "movies", "mp4", "mkv", "film"],
    audio: ["audio", "music", "song", "songs", "mp3", "track"],
    image: ["image", "images", "photo", "photos", "picture", "pictures", "png", "jpg", "jpeg"],
    pdf: ["pdf", "pdfs", "document", "documents"],
    text: ["text file", "txt", "markdown", "md", "note"],
    archive: ["zip", "archive", "archives", "rar"],
    apk: ["apk", "apps", "application package"]
  };

  var TIME_WORDS = {
    today: ["today", "aaj"],
    yesterday: ["yesterday", "kal"],
    week: ["this week", "last week", "past week", "is hafte"],
    month: ["this month", "last month", "past month"],
    older: ["old", "older", "purane"]
  };

  // -------------------------------------------------------------- matcher

  // Very small stemmer: enough to accept "files"/"file", "playing"/"play",
  // "searched"/"search" without pulling in a full morphology library.
  function stem(word) {
    var w = String(word || "").toLowerCase();
    if (w.length > 4 && /ing$/.test(w)) w = w.slice(0, -3);
    else if (w.length > 3 && /(es|ed)$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) w = w.slice(0, -1);
    return w;
  }

  function buildIndex(table) {
    // surface form -> [{ key, form, weight }], longest forms kept intact
    var index = {};
    Object.keys(table).forEach(function (key) {
      var entry = table[key];
      entry.forms.forEach(function (form) {
        (index[form] = index[form] || []).push({
          key: key, form: form, weight: entry.weight, words: form.split(" ").length
        });
      });
    });
    return index;
  }

  var actionIndex = buildIndex(ACTIONS);
  var modifierIndex = buildIndex(MODIFIERS);

  // All known surface forms, longest first, so "create folder" wins over "create".
  var actionForms = Object.keys(actionIndex).sort(function (a, b) {
    return b.length - a.length || b.split(" ").length - a.split(" ").length;
  });
  var modifierForms = Object.keys(modifierIndex).sort(function (a, b) {
    return b.length - a.length;
  });

  // Words too common to count as content when scoring coverage.
  var STOPWORDS = {
    the: 1, a: 1, an: 1, my: 1, me: 1, i: 1, to: 1, in: 1, on: 1, of: 1, for: 1,
    please: 1, can: 1, you: 1, could: 1, would: 1, do: 1, does: 1, is: 1, are: 1,
    it: 1, this: 1, that: 1, and: 1, with: 1, all: 1, some: 1, any: 1, there: 1,
    kar: 1, karo: 1, do: 1, please: 1, mujhe: 1, mera: 1, mere: 1, ko: 1, ka: 1, ki: 1
  };

  /**
   * Finds every concept of a kind in the text.
   *
   * Returns hits in utterance order with the character span consumed, so the
   * parser can tell which words were accounted for and which were not. That
   * span is what makes coverage scoring possible.
   */
  function find(text, index, forms) {
    var lower = String(text || "").toLowerCase();
    var hits = [];
    var taken = [];

    function overlaps(start, end) {
      for (var i = 0; i < taken.length; i++) {
        if (start < taken[i][1] && end > taken[i][0]) return true;
      }
      return false;
    }

    for (var f = 0; f < forms.length; f++) {
      var form = forms[f];
      var from = 0, at;
      while ((at = lower.indexOf(form, from)) !== -1) {
        var end = at + form.length;
        // Word-boundary check so "find" does not fire inside "finding" twice
        // and "top" does not fire inside "stop".
        var before = at > 0 ? lower.charAt(at - 1) : " ";
        var after = end < lower.length ? lower.charAt(end) : " ";
        var boundary = /[^a-z0-9]/.test(before) && /[^a-z0-9]/.test(after);
        if (boundary && !overlaps(at, end)) {
          taken.push([at, end]);
          var entries = index[form];
          for (var e = 0; e < entries.length; e++) {
            hits.push({
              key: entries[e].key,
              form: form,
              weight: entries[e].weight,
              start: at,
              end: end
            });
          }
        }
        from = end;
      }
    }
    hits.sort(function (a, b) { return a.start - b.start; });
    return hits;
  }

  function findActions(text) { return find(text, actionIndex, actionForms); }
  function findModifiers(text) { return find(text, modifierIndex, modifierForms); }

  /** Content words = tokens minus stopwords. Used as the coverage denominator. */
  function contentWords(text) {
    return String(text || "").toLowerCase()
      .replace(/[^a-z0-9\s/._-]/g, " ")
      .split(/\s+/)
      .filter(function (w) { return w && !STOPWORDS[w]; });
  }

  NLU.Lexicon = {
    ACTIONS: ACTIONS,
    MODIFIERS: MODIFIERS,
    FOLDERS: FOLDERS,
    FILE_TYPES: FILE_TYPES,
    TIME_WORDS: TIME_WORDS,
    STOPWORDS: STOPWORDS,
    stem: stem,
    findActions: findActions,
    findModifiers: findModifiers,
    contentWords: contentWords
  };
})(window);
