/* context.js - LocalHub OS Context Engine + State Manager.
 *
 * The Brain always knows the current LocalHub state so short commands like
 * "open it", "play it", "go back", "continue", "open previous folder" resolve
 * correctly without repeating a full command.
 *
 * All state is held in memory (deterministic, local, no ML). Recent items are
 * persisted to IndexedDB via Memory so the state survives a page reload.
 */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};
  global.LH_AI.modules = global.LH_AI.modules || {};

  var ROOT = "/storage/emulated/0";
  // Resolve Memory lazily so modules that load earlier/later (or stubs) still work.
  function Memory() { return global.LH_AI.Memory; }

  // In-memory current state (fast path).
  var state = {
    page: "assistant",        // assistant | files | player | dashboard
    folder: ROOT,             // current folder
    folderHistory: [],        // stack of previously visited folders
    media: null,              // { path, name, type }
    mediaHistory: [],         // recently played media
    currentFile: null,        // { path, name } last focused file
    selectedFiles: [],        // multi-select file paths
    clipboard: null,          // { action: "copy"|"move", path }
    client: null,             // last focused client
    clientHistory: [],
    search: null,             // last search query
    searchResults: [],
    server: null,             // last server status snapshot
    network: null,            // last network snapshot
    system: null,             // last system snapshot
    settingsScreen: "server", // current settings screen
    downloads: [],            // recent downloads
    uploads: [],              // recent uploads
    lastCommand: null,
    currentTask: null,        // active multi-step task
    currentPlaylist: [],      // playlist paths
    pinned: [],               // pinned folders
    favorites: [],            // favorite files
    recentCommands: [],
    lastActionResult: null,
    // lightweight conversational state (topic continuity)
    convo: {
      currentTopic: null,      // the subject the user is talking about
      lastQuestion: null,
      lastAnswer: null,
      lastSubject: null,
      history: []              // recent (input, subject) pairs
    }
  };

  // ---- public setters ----
  function set(key, value) {
    state[key] = value;
    // Persist navigation-related state.
    if (key === "folder" || key === "media" || key === "search") persist();
  }

  function get(key) { return state[key]; }

  function snapshot() { return JSON.parse(JSON.stringify(state)); }

  // ---- navigation state ----
  function setFolder(path) {
    if (path && path !== state.folder && state.folder) {
      state.folderHistory.push(state.folder);
      if (state.folderHistory.length > 30) state.folderHistory.shift();
    }
    state.folder = path || ROOT;
    persist();
  }

  function setMedia(path, type) {
    if (path) {
      state.media = { path: path, name: path.split("/").pop(), type: type || guessType(path) };
      state.mediaHistory.unshift(state.media);
      if (state.mediaHistory.length > 30) state.mediaHistory.pop();
      state.currentFile = { path: path, name: path.split("/").pop() };
      persist();
    }
  }

  function setCurrentFile(path) {
    if (path) state.currentFile = { path: path, name: path.split("/").pop() };
    persist();
  }

  function setSelectedFiles(paths) { state.selectedFiles = paths || []; persist(); }

  function setClipboard(action, path) { state.clipboard = path ? { action: action || "copy", path: path } : null; persist(); }

  function setPlaylist(paths) { state.currentPlaylist = paths || []; persist(); }

  function setSearch(query, results) {
    state.search = query;
    state.searchResults = results || [];
    persist();
  }

  function setClient(client) {
    if (client) {
      state.client = client;
      state.clientHistory.unshift(client);
      if (state.clientHistory.length > 20) state.clientHistory.pop();
    }
  }

  function guessType(path) {
    var e = path.split(".").pop().toLowerCase();
    if (/^(mp4|mkv|webm|avi|mov)$/.test(e)) return "video";
    if (/^(mp3|wav|ogg|m4a|flac)$/.test(e)) return "audio";
    if (/^(jpg|jpeg|png|gif|webp)$/.test(e)) return "image";
    return "file";
  }

  // ---- referent resolution: "it", "this", "previous folder", etc. ----
  function resolveReferent(text) {
    var t = text.toLowerCase();
    if (/(open|show|list|go to)\s+(it|that|this)/.test(t)) {
      return state.media && state.media.path
        ? { type: "media", path: state.media.path }
        : { type: "folder", path: state.folder };
    }
    if (/(play|start|resume)\s+(it|that|this)/.test(t)) {
      return state.media && state.media.path ? { type: "media", path: state.media.path } : null;
    }
    if (/(go\s+back|previous\s+folder|open\s+previous)/.test(t)) {
      return { type: "folder", path: state.folderHistory[state.folderHistory.length - 1] || state.folder };
    }
    if (/(continue|resume|last\s+media|last\s+video|last\s+movie)/.test(t)) {
      return state.mediaHistory[0] || (state.media && { type: state.media.type, path: state.media.path }) || null;
    }
    if (/(continue|resume|last\s+search|repeat\s+search)/.test(t) && /search/.test(t)) {
      return state.search ? { type: "search", query: state.search, results: state.searchResults } : null;
    }
    return null;
  }

  function goBackFolder() {
    var prev = state.folderHistory.pop();
    if (prev) { state.folder = prev; persist(); }
    return prev || state.folder;
  }

  // ---- persistence (local, LocalHub state only) ----
  function persist() {
    var mem = Memory();
    if (!mem || !mem.put) return;
    mem.put("context", {
      id: "context",
      folder: state.folder,
      folderHistory: state.folderHistory,
      media: state.media,
      mediaHistory: state.mediaHistory,
      currentFile: state.currentFile,
      selectedFiles: state.selectedFiles,
      clipboard: state.clipboard,
      currentPlaylist: state.currentPlaylist,
      search: state.search,
      searchResults: state.searchResults,
      client: state.client,
      recentCommands: state.recentCommands,
      pinned: state.pinned,
      favorites: state.favorites
    }).catch(function () {});
  }

  function load() {
    var mem = Memory();
    if (!mem || !mem.getAll) return Promise.resolve();
    return mem.getAll("context").then(function (all) {
      var c = all && all[0];
      if (!c) return;
      if (c.folder) state.folder = c.folder;
      if (c.folderHistory) state.folderHistory = c.folderHistory;
      if (c.media) state.media = c.media;
      if (c.mediaHistory) state.mediaHistory = c.mediaHistory;
      if (c.currentFile) state.currentFile = c.currentFile;
      if (c.selectedFiles) state.selectedFiles = c.selectedFiles;
      if (c.clipboard) state.clipboard = c.clipboard;
      if (c.currentPlaylist) state.currentPlaylist = c.currentPlaylist;
      if (c.search) state.search = c.search;
      if (c.recentCommands) state.recentCommands = c.recentCommands;
      if (c.pinned) state.pinned = c.pinned;
      if (c.favorites) state.favorites = c.favorites;
    }).catch(function () {});
  }

  // ---- recent command tracking ----
  function recordCommand(text) {
    state.recentCommands.unshift(text);
    if (state.recentCommands.length > 30) state.recentCommands.pop();
    persist();
  }

  function togglePin(path) {
    var i = state.pinned.indexOf(path);
    if (i >= 0) state.pinned.splice(i, 1);
    else state.pinned.unshift(path);
    persist();
    return state.pinned;
  }

  function toggleFavorite(path) {
    var i = state.favorites.indexOf(path);
    if (i >= 0) state.favorites.splice(i, 1);
    else state.favorites.unshift(path);
    persist();
    return state.favorites;
  }

  // ---- lightweight conversational state ----
  // Records the current subject and recent turns so follow-ups like "and your
  // memory?", "what about that?", "how does it learn?" continue the topic.
  function setTopic(subject, question, answer) {
    state.convo = state.convo || { currentTopic: null, lastQuestion: null, lastAnswer: null, lastSubject: null, history: [] };
    state.convo.lastSubject = state.convo.currentTopic;
    state.convo.currentTopic = subject || state.convo.currentTopic;
    state.convo.lastQuestion = question != null ? question : state.convo.lastQuestion;
    state.convo.lastAnswer = answer != null ? answer : state.convo.lastAnswer;
    state.convo.history.push({ input: question || "", subject: subject || "", ts: Date.now() });
    if (state.convo.history.length > 20) state.convo.history.shift();
  }
  function getTopic() {
    var c = state.convo || {};
    return { currentTopic: c.currentTopic, lastSubject: c.lastSubject, lastQuestion: c.lastQuestion, lastAnswer: c.lastAnswer, history: c.history || [] };
  }

  global.LH_AI.Context = {
    set: set,
    get: get,
    snapshot: snapshot,
    setFolder: setFolder,
    setMedia: setMedia,
    setCurrentFile: setCurrentFile,
    setSelectedFiles: setSelectedFiles,
    setClipboard: setClipboard,
    setPlaylist: setPlaylist,
    setSearch: setSearch,
    setClient: setClient,
    goBackFolder: goBackFolder,
    resolveReferent: resolveReferent,
    recordCommand: recordCommand,
    togglePin: togglePin,
    toggleFavorite: toggleFavorite,
    setTopic: setTopic,
    getTopic: getTopic,
    load: load,
    ROOT: ROOT
  };
})(window);
