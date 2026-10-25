/**
 * LocalHub Pro Features Suite (v2.0)
 * ----------------------------------------------------------------------------
 * 1. 🍿 Media Lounge (Movies Cinema stream, Docked Audio Player, Photo Gallery & Slideshow)
 * 2. 💬 Local Connect (Universal Shared Clipboard, Zero-Data LAN Chat Room, Sticky Notice Wall)
 * 3. 📖 Reader & Notes (In-Browser Document & PDF Viewer, TTS Read Aloud Audiobook, Scratchpad)
 * 4. 🧠 Quick AI Assistant & Voice Navigator
 */
(function () {
  "use strict";

  // Helpers
  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtBytes(bytes) {
    if (bytes == null || isNaN(bytes) || bytes === 0) return "0 B";
    var k = 1024, dm = 1, sizes = ["B", "KB", "MB", "GB", "TB"];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  }

  function authFetch(url, opt) {
    opt = opt || {};
    opt.headers = opt.headers || {};
    var token = (typeof authToken !== "undefined" && authToken) ? authToken :
      (sessionStorage.getItem("lhtoken") || localStorage.getItem("lhtoken") || "");
    if (token) opt.headers["Authorization"] = "Bearer " + token;
    return fetch(url, opt);
  }

  function postJson(url, data) {
    return authFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data || {})
    }).then(function (r) { return r.json(); });
  }

  function showToast(msg, isSuccess) {
    var toast = $("lh-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "lh-toast";
      toast.className = "lh-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = "lh-toast show " + (isSuccess ? "toast-success" : "");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      toast.className = "lh-toast";
    }, 3200);
  }

  // --------------------------------------------------------------------------
  // 1. 🍿 MEDIA LOUNGE (Movies, Music Lounge, Photo Gallery)
  // --------------------------------------------------------------------------
  var mediaCatalog = { videos: [], audio: [], photos: [], documents: [] };
  var currentPlaylist = [];
  var currentTrackIdx = -1;
  var audioPlayer = null;
  var currentSlideshowTimer = null;
  var activePhotoList = [];
  var activePhotoIdx = 0;

  function loadMediaCatalog() {
    var statusEl = $("lounge-status");
    if (statusEl) statusEl.textContent = "Scanning media library…";
    authFetch("/api/hub/media-catalog")
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) throw new Error("Catalog unavailable");
        mediaCatalog = res;
        renderMediaLounge();
        if (statusEl) statusEl.textContent = "Library up to date (" +
          ((res.videos || []).length) + " videos, " +
          ((res.audio || []).length) + " tracks, " +
          ((res.photos || []).length) + " photos)";
      })
      .catch(function () {
        // Fallback: search root for common media
        fallbackMediaCatalog();
      });
  }

  function fallbackMediaCatalog() {
    authFetch("/api/fs/list?limit=100")
      .then(function (r) { return r.json(); })
      .then(function (res) {
        var files = (res && res.files) ? res.files : [];
        mediaCatalog = {
          videos: files.filter(function (f) { return (f.category === "video" || /\.(mp4|mkv|webm|mov|avi)$/i.test(f.name)); }),
          audio: files.filter(function (f) { return (f.category === "audio" || /\.(mp3|aac|m4a|flac|wav|ogg)$/i.test(f.name)); }),
          photos: files.filter(function (f) { return (f.category === "image" || /\.(jpg|jpeg|png|webp|gif)$/i.test(f.name)); }),
          documents: files.filter(function (f) { return (f.category === "document" || /\.(pdf|txt|md|json|log)$/i.test(f.name)); })
        };
        renderMediaLounge();
      }).catch(function () {});
  }

  function renderMediaLounge() {
    renderMoviesShelf();
    renderAudioLounge();
    renderPhotosGallery();
    renderDocumentsLibrary();
  }

  function renderMoviesShelf() {
    var host = $("movies-shelf");
    if (!host) return;
    var list = mediaCatalog.videos || [];
    if (!list.length) {
      host.innerHTML = '<div class="empty-hint">🎬 No video files detected yet. Upload videos via Quick Drop or place them in Movies / Download folder!</div>';
      return;
    }
    host.innerHTML = list.slice(0, 24).map(function (m) {
      var name = m.name;
      var cleanTitle = name.replace(/\.[^/.]+$/, "").replace(/[._-]/g, " ");
      var pathEnc = encodeURIComponent(m.path);
      return '<div class="media-card">' +
        '<div class="media-poster-box">' +
          '<div class="media-poster-icon">🎬</div>' +
          '<a class="media-play-overlay" href="/player?file=' + pathEnc + '" title="Stream Cinema">' +
            '<span class="play-symbol">▶</span>' +
          '</a>' +
          '<span class="media-badge">' + (m.ext || "video").toUpperCase() + '</span>' +
        '</div>' +
        '<div class="media-info">' +
          '<div class="media-title" title="' + escapeHtml(name) + '">' + escapeHtml(cleanTitle) + '</div>' +
          '<div class="media-meta">' + fmtBytes(m.size) + '</div>' +
          '<div class="media-card-actions">' +
            '<a class="btn-micro" href="/player?file=' + pathEnc + '">▶ Play</a>' +
            '<a class="btn-micro ghost" href="/api/fs/download?path=' + pathEnc + '" download>⬇ Download</a>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  function renderAudioLounge() {
    var host = $("audio-playlist");
    if (!host) return;
    currentPlaylist = mediaCatalog.audio || [];
    if (!currentPlaylist.length) {
      host.innerHTML = '<div class="empty-hint">🎵 No audio tracks found yet. Add songs to your Music or Download folder!</div>';
      return;
    }
    host.innerHTML = currentPlaylist.slice(0, 30).map(function (track, idx) {
      var cleanTitle = track.name.replace(/\.[^/.]+$/, "").replace(/[._-]/g, " ");
      return '<div class="audio-track-row ' + (currentTrackIdx === idx ? 'playing' : '') + '" data-idx="' + idx + '">' +
        '<button class="track-play-btn" type="button">' + (currentTrackIdx === idx ? '⏸' : '▶') + '</button>' +
        '<div class="track-details">' +
          '<div class="track-name">' + escapeHtml(cleanTitle) + '</div>' +
          '<div class="track-sub">' + fmtBytes(track.size) + '</div>' +
        '</div>' +
        '<a class="track-dl-link" href="/api/fs/download?path=' + encodeURIComponent(track.path) + '" download title="Download">⬇</a>' +
      '</div>';
    }).join("");

    // Wire clicks
    host.querySelectorAll(".audio-track-row").forEach(function (row) {
      row.onclick = function (e) {
        if (e.target.tagName === "A") return;
        var idx = parseInt(row.getAttribute("data-idx"), 10);
        playTrackAt(idx);
      };
    });
  }

  function initAudioPlayer() {
    audioPlayer = $("docked-audio-tag");
    if (!audioPlayer) return;

    var btnPlay = $("audio-btn-play");
    var btnNext = $("audio-btn-next");
    var btnPrev = $("audio-btn-prev");
    var bar = $("audio-progress-bar");
    var timeTxt = $("audio-time-txt");

    if (btnPlay) {
      btnPlay.onclick = function () {
        if (!audioPlayer.src) {
          if (currentPlaylist.length) playTrackAt(0);
          return;
        }
        if (audioPlayer.paused) {
          audioPlayer.play();
          btnPlay.textContent = "⏸";
        } else {
          audioPlayer.pause();
          btnPlay.textContent = "▶";
        }
      };
    }
    if (btnNext) {
      btnNext.onclick = function () {
        if (!currentPlaylist.length) return;
        var next = (currentTrackIdx + 1) % currentPlaylist.length;
        playTrackAt(next);
      };
    }
    if (btnPrev) {
      btnPrev.onclick = function () {
        if (!currentPlaylist.length) return;
        var prev = (currentTrackIdx - 1 + currentPlaylist.length) % currentPlaylist.length;
        playTrackAt(prev);
      };
    }

    audioPlayer.ontimeupdate = function () {
      if (!audioPlayer.duration || isNaN(audioPlayer.duration)) return;
      var pct = (audioPlayer.currentTime / audioPlayer.duration) * 100;
      if (bar) bar.style.width = pct + "%";
      if (timeTxt) {
        var cur = formatTime(audioPlayer.currentTime);
        var dur = formatTime(audioPlayer.duration);
        timeTxt.textContent = cur + " / " + dur;
      }
    };

    audioPlayer.onended = function () {
      if (currentPlaylist.length) {
        var next = (currentTrackIdx + 1) % currentPlaylist.length;
        playTrackAt(next);
      }
    };

    var seekTrack = $("audio-progress-track");
    if (seekTrack) {
      seekTrack.onclick = function (e) {
        if (!audioPlayer.duration) return;
        var rect = seekTrack.getBoundingClientRect();
        var clickX = e.clientX - rect.left;
        var ratio = Math.max(0, Math.min(1, clickX / rect.width));
        audioPlayer.currentTime = ratio * audioPlayer.duration;
      };
    }
  }

  function playTrackAt(idx) {
    if (!audioPlayer || idx < 0 || idx >= currentPlaylist.length) return;
    currentTrackIdx = idx;
    var track = currentPlaylist[idx];
    audioPlayer.src = "/api/fs/content?path=" + encodeURIComponent(track.path);
    audioPlayer.play().catch(function () {});

    var btnPlay = $("audio-btn-play");
    if (btnPlay) btnPlay.textContent = "⏸";

    var titleEl = $("docked-track-title");
    if (titleEl) titleEl.textContent = track.name.replace(/\.[^/.]+$/, "").replace(/[._-]/g, " ");

    renderAudioLounge();
    showToast("▶ Playing: " + track.name, true);
  }

  function formatTime(sec) {
    var s = Math.floor(sec) || 0;
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function renderPhotosGallery() {
    var host = $("photos-grid");
    if (!host) return;
    activePhotoList = mediaCatalog.photos || [];
    if (!activePhotoList.length) {
      host.innerHTML = '<div class="empty-hint">📸 No photos found yet. Place photos in DCIM / Pictures / Download!</div>';
      return;
    }
    host.innerHTML = activePhotoList.slice(0, 48).map(function (photo, idx) {
      var src = "/api/fs/content?path=" + encodeURIComponent(photo.path);
      return '<div class="gallery-item" data-idx="' + idx + '" title="' + escapeHtml(photo.name) + '">' +
        '<img src="' + src + '" alt="' + escapeHtml(photo.name) + '" loading="lazy" />' +
        '<div class="gallery-caption">' + escapeHtml(photo.name) + '</div>' +
      '</div>';
    }).join("");

    host.querySelectorAll(".gallery-item").forEach(function (item) {
      item.onclick = function () {
        var idx = parseInt(item.getAttribute("data-idx"), 10);
        openLightbox(idx);
      };
    });
  }

  function openLightbox(idx) {
    if (idx < 0 || idx >= activePhotoList.length) return;
    activePhotoIdx = idx;
    var modal = $("lightbox-modal");
    var img = $("lightbox-img");
    var caption = $("lightbox-caption");
    if (!modal || !img) return;

    var photo = activePhotoList[idx];
    img.src = "/api/fs/content?path=" + encodeURIComponent(photo.path);
    if (caption) caption.textContent = (idx + 1) + " / " + activePhotoList.length + " — " + photo.name;
    modal.classList.add("active");
  }

  function closeLightbox() {
    var modal = $("lightbox-modal");
    if (modal) modal.classList.remove("active");
    stopSlideshow();
  }

  function toggleSlideshow() {
    var btn = $("btn-slideshow-toggle");
    if (currentSlideshowTimer) {
      stopSlideshow();
      if (btn) btn.textContent = "▶ Start Slideshow";
      showToast("Slideshow stopped", false);
    } else {
      if (btn) btn.textContent = "⏹ Stop Slideshow";
      showToast("Slideshow started (3s interval)", true);
      currentSlideshowTimer = setInterval(function () {
        if (!activePhotoList.length) return;
        activePhotoIdx = (activePhotoIdx + 1) % activePhotoList.length;
        openLightbox(activePhotoIdx);
      }, 3000);
    }
  }

  function stopSlideshow() {
    if (currentSlideshowTimer) {
      clearInterval(currentSlideshowTimer);
      currentSlideshowTimer = null;
    }
    var btn = $("btn-slideshow-toggle");
    if (btn) btn.textContent = "▶ Start Slideshow";
  }

  function wireLightboxControls() {
    var modal = $("lightbox-modal");
    if (!modal) return;
    var closeBtn = $("lightbox-close");
    var nextBtn = $("lightbox-next");
    var prevBtn = $("lightbox-prev");
    var ssBtn = $("btn-slideshow-toggle");

    if (closeBtn) closeBtn.onclick = closeLightbox;
    if (nextBtn) nextBtn.onclick = function () {
      if (activePhotoList.length) {
        activePhotoIdx = (activePhotoIdx + 1) % activePhotoList.length;
        openLightbox(activePhotoIdx);
      }
    };
    if (prevBtn) prevBtn.onclick = function () {
      if (activePhotoList.length) {
        activePhotoIdx = (activePhotoIdx - 1 + activePhotoList.length) % activePhotoList.length;
        openLightbox(activePhotoIdx);
      }
    };
    if (ssBtn) ssBtn.onclick = toggleSlideshow;

    modal.onclick = function (e) {
      if (e.target === modal) closeLightbox();
    };

    document.addEventListener("keydown", function (e) {
      if (!modal.classList.contains("active")) return;
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowRight") nextBtn && nextBtn.click();
      else if (e.key === "ArrowLeft") prevBtn && prevBtn.click();
    });
  }

  // --------------------------------------------------------------------------
  // 2. 💬 LOCAL CONNECT (Universal Clipboard, LAN Live Chat, Sticky Wall)
  // --------------------------------------------------------------------------
  var lastChatTimestamp = 0;
  var currentNickname = localStorage.getItem("lh_nickname") || ("Guest-" + Math.floor(100 + Math.random() * 900));

  function initUniversalClipboard() {
    var txtEl = $("clip-live-text");
    var copyBtn = $("clip-copy-btn");
    var inputEl = $("clip-input");
    var sendBtn = $("clip-send-btn");
    var histHost = $("clip-history-list");

    function fetchClip() {
      authFetch("/api/hub/clipboard")
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || !res.ok) return;
          if (txtEl) {
            txtEl.textContent = res.text || "(Clipboard is empty)";
            txtEl.setAttribute("data-raw", res.text || "");
          }
          var metaEl = $("clip-live-meta");
          if (metaEl) {
            var timeAgo = res.updatedAt ? new Date(res.updatedAt).toLocaleTimeString() : "";
            metaEl.textContent = "Synced at " + timeAgo + " by " + (res.author || "User");
          }
          if (histHost && res.history) {
            histHost.innerHTML = res.history.map(function (item) {
              return '<button class="clip-history-chip" type="button" title="' + escapeHtml(item.text) + '">' +
                '<span class="chip-text">' + escapeHtml(item.text.slice(0, 40)) + (item.text.length > 40 ? "…" : "") + '</span>' +
              '</button>';
            }).join("");
            histHost.querySelectorAll(".clip-history-chip").forEach(function (btn, i) {
              btn.onclick = function () {
                var text = (res.history[i] && res.history[i].text) || "";
                if (text) sendClipboard(text);
              };
            });
          }
        }).catch(function () {});
    }

    function sendClipboard(text) {
      text = text || (inputEl ? inputEl.value : "");
      if (!text || !text.trim()) return;
      postJson("/api/hub/clipboard", { text: text, author: currentNickname })
        .then(function (res) {
          if (res && res.ok) {
            if (inputEl) inputEl.value = "";
            fetchClip();
            showToast("✓ Synced to all devices!", true);
          }
        }).catch(function () {
          showToast("Failed to share clipboard", false);
        });
    }

    if (copyBtn) {
      copyBtn.onclick = function () {
        var raw = (txtEl && txtEl.getAttribute("data-raw")) || (txtEl ? txtEl.textContent : "");
        if (!raw) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(raw).then(function () {
            showToast("✓ Copied to your device clipboard!", true);
          }).catch(function () {
            fallbackCopy(raw);
          });
        } else {
          fallbackCopy(raw);
        }
      };
    }

    function fallbackCopy(text) {
      var ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        showToast("✓ Copied to device clipboard!", true);
      } catch (e) {
        showToast("Press Ctrl+C to copy", false);
      }
      document.body.removeChild(ta);
    }

    if (sendBtn) {
      sendBtn.onclick = function () { sendClipboard(); };
    }
    if (inputEl) {
      inputEl.onkeydown = function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendClipboard();
        }
      };
    }

    fetchClip();
    setInterval(fetchClip, 3500);
  }

  function initLiveChat() {
    var feed = $("chat-messages-feed");
    var input = $("chat-message-input");
    var btnSend = $("chat-message-send");
    var nickInput = $("chat-nickname-input");
    var nickDisplay = $("chat-my-nick");

    if (nickInput) {
      nickInput.value = currentNickname;
      nickInput.onchange = function () {
        currentNickname = nickInput.value.trim() || currentNickname;
        localStorage.setItem("lh_nickname", currentNickname);
        if (nickDisplay) nickDisplay.textContent = currentNickname;
        showToast("Nickname set: " + currentNickname, true);
      };
    }
    if (nickDisplay) nickDisplay.textContent = currentNickname;

    function pollChat() {
      authFetch("/api/hub/chat?since=" + lastChatTimestamp)
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || !res.ok || !res.messages) return;
          var newMsgs = res.messages;
          if (newMsgs.length) {
            newMsgs.forEach(function (m) {
              if (m.time > lastChatTimestamp) lastChatTimestamp = m.time;
              appendChatMessage(m);
            });
            if (feed) feed.scrollTop = feed.scrollHeight;
          }
        }).catch(function () {});
    }

    function appendChatMessage(m) {
      if (!feed) return;
      var isMe = (m.author === currentNickname);
      var timeStr = m.time ? new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
      var row = document.createElement("div");
      row.className = "chat-msg-row " + (isMe ? "msg-mine" : "msg-theirs");
      row.innerHTML = '<div class="msg-bubble" style="border-left-color:' + escapeHtml(m.color || '#38bdf8') + '">' +
        '<div class="msg-header">' +
          '<span class="msg-author" style="color:' + escapeHtml(m.color || '#38bdf8') + '">' + escapeHtml(m.author || "User") + '</span>' +
          '<span class="msg-time">' + timeStr + '</span>' +
        '</div>' +
        '<div class="msg-body">' + escapeHtml(m.text) + '</div>' +
      '</div>';
      feed.appendChild(row);
    }

    function sendMessage(text) {
      text = text || (input ? input.value : "");
      if (!text || !text.trim()) return;
      postJson("/api/hub/chat", {
        text: text.trim(),
        author: currentNickname,
        color: "#38bdf8"
      }).then(function (res) {
        if (res && res.ok) {
          if (input) input.value = "";
          pollChat();
        }
      }).catch(function () {});
    }

    if (btnSend) {
      btnSend.onclick = function () { sendMessage(); };
    }
    if (input) {
      input.onkeydown = function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          sendMessage();
        }
      };
    }

    // Reaction quick chips
    document.querySelectorAll(".chat-quick-emoji").forEach(function (chip) {
      chip.onclick = function () {
        sendMessage(chip.textContent);
      };
    });

    pollChat();
    setInterval(pollChat, 2500);
  }

  function initNoticeWall() {
    var wallGrid = $("wall-notes-grid");
    var btnAdd = $("btn-wall-add");
    var formBox = $("wall-add-form");
    var btnSubmit = $("wall-submit-note");
    var btnCancel = $("wall-cancel-note");

    function fetchWall() {
      authFetch("/api/hub/wall")
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || !res.ok || !wallGrid) return;
          var notes = res.notes || [];
          if (!notes.length) {
            wallGrid.innerHTML = '<div class="empty-hint">📌 No notices posted yet. Post a note for everyone on this LAN!</div>';
            return;
          }
          wallGrid.innerHTML = notes.map(function (note) {
            var colorClass = "note-" + (note.color || "yellow");
            var timeStr = note.time ? new Date(note.time).toLocaleDateString() : "";
            return '<div class="sticky-note ' + colorClass + ' ' + (note.pinned ? "note-pinned" : "") + '" data-id="' + note.id + '">' +
              '<div class="note-head">' +
                '<span class="note-pin">' + (note.pinned ? "📌 " : "") + '<b>' + escapeHtml(note.title || "Note") + '</b></span>' +
                '<button class="note-del-btn" title="Delete note">✕</button>' +
              '</div>' +
              '<div class="note-content">' + escapeHtml(note.content) + '</div>' +
              '<div class="note-foot">' +
                '<span>' + escapeHtml(note.author || "User") + '</span>' +
                '<span>' + timeStr + '</span>' +
              '</div>' +
            '</div>';
          }).join("");

          wallGrid.querySelectorAll(".note-del-btn").forEach(function (btn) {
            btn.onclick = function (e) {
              e.stopPropagation();
              var card = btn.closest(".sticky-note");
              var id = card.getAttribute("data-id");
              postJson("/api/hub/wall/delete", { id: id }).then(function () {
                fetchWall();
                showToast("Note deleted", true);
              });
            };
          });
        }).catch(function () {});
    }

    if (btnAdd && formBox) {
      btnAdd.onclick = function () {
        formBox.style.display = formBox.style.display === "none" ? "block" : "none";
      };
    }
    if (btnCancel && formBox) {
      btnCancel.onclick = function () { formBox.style.display = "none"; };
    }
    if (btnSubmit) {
      btnSubmit.onclick = function () {
        var title = ($("note-input-title") || {}).value || "";
        var content = ($("note-input-content") || {}).value || "";
        var color = ($("note-input-color") || {}).value || "yellow";
        var pinned = ($("note-input-pinned") || {}).checked || false;
        if (!content.trim()) {
          showToast("Please enter note content", false);
          return;
        }
        postJson("/api/hub/wall", {
          title: title,
          content: content,
          author: currentNickname,
          color: color,
          pinned: pinned
        }).then(function (res) {
          if (res && res.ok) {
            if ($("note-input-title")) $("note-input-title").value = "";
            if ($("note-input-content")) $("note-input-content").value = "";
            if (formBox) formBox.style.display = "none";
            fetchWall();
            showToast("✓ Note pinned to wall!", true);
          }
        });
      };
    }

    fetchWall();
  }

  // --------------------------------------------------------------------------
  // 3. 📖 READER & NOTES (Clean Document View, TTS Audiobook, Scratchpad)
  // --------------------------------------------------------------------------
  var currentReaderPath = "";
  var currentReaderText = "";
  var readerAudioTag = null;

  function renderDocumentsLibrary() {
    var host = $("reader-doc-list");
    if (!host) return;
    var docs = mediaCatalog.documents || [];
    if (!docs.length) {
      host.innerHTML = '<div class="empty-hint">📚 No documents found. Upload PDF, TXT or Markdown files!</div>';
      return;
    }
    host.innerHTML = docs.slice(0, 30).map(function (doc) {
      var isPdf = /\.pdf$/i.test(doc.name);
      return '<div class="doc-item-row" data-path="' + escapeHtml(doc.path) + '">' +
        '<span class="doc-icon">' + (isPdf ? '📕' : '📄') + '</span>' +
        '<div class="doc-meta">' +
          '<div class="doc-name">' + escapeHtml(doc.name) + '</div>' +
          '<div class="doc-size">' + fmtBytes(doc.size) + '</div>' +
        '</div>' +
        '<button class="btn-micro" type="button">Open</button>' +
      '</div>';
    }).join("");

    host.querySelectorAll(".doc-item-row").forEach(function (row) {
      row.onclick = function () {
        var path = row.getAttribute("data-path");
        openDocumentInReader(path);
      };
    });
  }

  function openDocumentInReader(path) {
    if (!path) return;
    currentReaderPath = path;
    var isPdf = /\.pdf$/i.test(path);
    var pane = $("reader-viewer-pane");
    var titleEl = $("reader-doc-title");
    var bodyEl = $("reader-doc-body");
    var ttsBtn = $("reader-btn-tts");
    if (!pane || !bodyEl) return;

    if (titleEl) titleEl.textContent = path.split("/").pop();
    pane.style.display = "block";

    if (isPdf) {
      bodyEl.innerHTML = '<iframe src="/api/fs/content?path=' + encodeURIComponent(path) + '" class="reader-pdf-frame"></iframe>';
      currentReaderText = "";
      if (ttsBtn) ttsBtn.style.display = "none";
      return;
    }

    if (ttsBtn) ttsBtn.style.display = "";
    bodyEl.innerHTML = '<div class="loading"><div class="spinner"></div>Opening document…</div>';

    authFetch("/api/fs/read?path=" + encodeURIComponent(path))
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok || res.content == null) {
          bodyEl.innerHTML = '<div class="empty-hint">Could not read file preview. <a href="/api/fs/download?path=' + encodeURIComponent(path) + '" download>Download file</a></div>';
          return;
        }
        currentReaderText = res.content;
        bodyEl.innerHTML = '<pre class="reader-text-content">' + escapeHtml(res.content) + '</pre>';
      }).catch(function () {
        bodyEl.innerHTML = '<div class="empty-hint">Failed to load document content.</div>';
      });
  }

  function initReaderControls() {
    readerAudioTag = $("reader-tts-audio");
    var ttsBtn = $("reader-btn-tts");
    var closeBtn = $("reader-btn-close");
    var zoomIn = $("reader-zoom-in");
    var zoomOut = $("reader-zoom-out");
    var bodyEl = $("reader-doc-body");
    var currentFontSize = 14;

    if (closeBtn) {
      closeBtn.onclick = function () {
        var pane = $("reader-viewer-pane");
        if (pane) pane.style.display = "none";
        if (readerAudioTag) readerAudioTag.pause();
      };
    }

    if (zoomIn) {
      zoomIn.onclick = function () {
        currentFontSize = Math.min(26, currentFontSize + 2);
        if (bodyEl) bodyEl.style.fontSize = currentFontSize + "px";
      };
    }
    if (zoomOut) {
      zoomOut.onclick = function () {
        currentFontSize = Math.max(11, currentFontSize - 2);
        if (bodyEl) bodyEl.style.fontSize = currentFontSize + "px";
      };
    }

    if (ttsBtn) {
      ttsBtn.onclick = function () {
        if (!currentReaderText || !currentReaderText.trim()) {
          showToast("No readable text in this document", false);
          return;
        }
        var snippet = currentReaderText.slice(0, 3000);
        ttsBtn.textContent = "🔊 Generating speech…";
        postJson("/api/tts/synthesize", { text: snippet, speed: 1.0, lang: "en-US" })
          .then(function (res) {
            ttsBtn.textContent = "🔊 Read Aloud (TTS)";
            if (res && res.ok && res.url) {
              if (readerAudioTag) {
                readerAudioTag.src = res.url;
                readerAudioTag.play();
                showToast("🔊 Playing audiobook narration!", true);
              }
            } else {
              showToast("TTS not available on this phone", false);
            }
          }).catch(function () {
            ttsBtn.textContent = "🔊 Read Aloud (TTS)";
            showToast("TTS synthesis error", false);
          });
      };
    }
  }

  function initScratchpad() {
    var ta = $("scratchpad-textarea");
    var btnSave = $("scratchpad-save");
    var meta = $("scratchpad-meta");
    if (!ta) return;

    authFetch("/api/hub/notes")
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok && res.content) {
          ta.value = res.content;
          if (meta && res.updatedAt) meta.textContent = "Last saved: " + new Date(res.updatedAt).toLocaleTimeString();
        }
      }).catch(function () {});

    if (btnSave) {
      btnSave.onclick = function () {
        postJson("/api/hub/notes", { content: ta.value }).then(function (res) {
          if (res && res.ok) {
            showToast("✓ Scratchpad saved to server!", true);
            if (meta) meta.textContent = "Last saved: " + new Date().toLocaleTimeString();
          }
        });
      };
    }
  }

  // --------------------------------------------------------------------------
  // 4. 🧠 QUICK AI ASSISTANT WIDGET & SEARCH
  // --------------------------------------------------------------------------
  function initQuickAssistant() {
    var input = $("ai-quick-input");
    var btn = $("ai-quick-btn");
    var micBtn = $("ai-quick-mic");
    var resBox = $("ai-quick-result");

    function executeQuery(q) {
      q = q || (input ? input.value : "");
      if (!q || !q.trim()) return;
      if (resBox) {
        resBox.style.display = "block";
        resBox.innerHTML = '<div class="ai-reply-bubble"><div class="spinner"></div> Thinking…</div>';
      }

      var qLower = q.toLowerCase();
      // Fast client-side intent execution
      if (qLower.indexOf("video") >= 0 || qLower.indexOf("movie") >= 0) {
        if (window.lhSetTab) window.lhSetTab("lounge");
        if (resBox) resBox.innerHTML = '<div class="ai-reply-bubble">🍿 Switched to <b>Media Lounge</b>! Showing your videos.</div>';
        return;
      }
      if (qLower.indexOf("music") >= 0 || qLower.indexOf("song") >= 0) {
        if (window.lhSetTab) window.lhSetTab("lounge");
        if (resBox) resBox.innerHTML = '<div class="ai-reply-bubble">🎵 Opened <b>Music Lounge</b>! You can play your playlist now.</div>';
        return;
      }
      if (qLower.indexOf("battery") >= 0 || qLower.indexOf("storage") >= 0 || qLower.indexOf("vitals") >= 0) {
        authFetch("/api/system")
          .then(function (r) { return r.json(); })
          .then(function (sys) {
            var b = (sys.battery && sys.battery.level != null) ? sys.battery.level + "%" : "Normal";
            var s = (sys.storage && sys.storage.freeBytes) ? fmtBytes(sys.storage.freeBytes) + " free" : "OK";
            if (resBox) resBox.innerHTML = '<div class="ai-reply-bubble">🔋 Phone Battery: <b>' + b + '</b> · 💾 Storage: <b>' + s + '</b></div>';
          });
        return;
      }
      if (qLower.indexOf("chat") >= 0 || qLower.indexOf("clip") >= 0) {
        if (window.lhSetTab) window.lhSetTab("connect");
        if (resBox) resBox.innerHTML = '<div class="ai-reply-bubble">💬 Switched to <b>Local Connect</b> (Clipboard & Chat room)!</div>';
        return;
      }

      // Deep query -> forward to AI Assistant
      authFetch("/api/fs/search?q=" + encodeURIComponent(q))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var matches = (data && data.matches) ? data.matches : [];
          if (matches.length) {
            var html = '<div class="ai-reply-bubble">Found <b>' + matches.length + '</b> matches for <i>"' + escapeHtml(q) + '"</i>:<ul>';
            matches.slice(0, 5).forEach(function (m) {
              html += '<li><a href="/files">' + escapeHtml(m.name) + '</a> (' + fmtBytes(m.size) + ')</li>';
            });
            html += '</ul><a class="btn-micro" href="/ai/">Open Assistant for full conversation ➔</a></div>';
            if (resBox) resBox.innerHTML = html;
          } else {
            if (resBox) resBox.innerHTML = '<div class="ai-reply-bubble">I searched the server for "<b>' + escapeHtml(q) + '</b>". <br><a class="btn-micro" style="margin-top:6px" href="/ai/">Open Full AI Assistant ➔</a></div>';
          }
        }).catch(function () {
          if (resBox) resBox.innerHTML = '<div class="ai-reply-bubble"><a href="/ai/">Open Full AI Assistant ➔</a></div>';
        });
    }

    if (btn) btn.onclick = function () { executeQuery(); };
    if (input) {
      input.onkeydown = function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          executeQuery();
        }
      };
    }

    // Voice recognition
    if (micBtn && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      var Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
      var recognition = new Speech();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onresult = function (e) {
        var transcript = e.results[0][0].transcript;
        if (input) input.value = transcript;
        micBtn.classList.remove("recording");
        executeQuery(transcript);
      };
      recognition.onerror = function () {
        micBtn.classList.remove("recording");
        showToast("Voice not recognized", false);
      };
      recognition.onend = function () {
        micBtn.classList.remove("recording");
      };
      micBtn.onclick = function () {
        try {
          micBtn.classList.add("recording");
          recognition.start();
          showToast("🎤 Listening… speak now", true);
        } catch (e) {
          recognition.stop();
        }
      };
    } else if (micBtn) {
      micBtn.title = "Voice recognition requires Chrome/Safari on HTTPS or localhost";
    }

    // Prompt chips
    document.querySelectorAll(".ai-prompt-chip").forEach(function (chip) {
      chip.onclick = function () {
        if (input) input.value = chip.textContent;
        executeQuery(chip.textContent);
      };
    });
  }

  // --------------------------------------------------------------------------
  // Global Initializer
  // --------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    loadMediaCatalog();
    initAudioPlayer();
    wireLightboxControls();
    initUniversalClipboard();
    initLiveChat();
    initNoticeWall();
    initReaderControls();
    initScratchpad();
    initQuickAssistant();
  });

  // Expose reload triggers
  window.LH_HUB = {
    reloadMedia: loadMediaCatalog,
    openDocument: openDocumentInReader
  };
})();
