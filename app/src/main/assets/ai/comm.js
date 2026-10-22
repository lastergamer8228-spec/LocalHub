/* comm.js - LocalHub Communication & Presentation engine.
 *
 * Makes the assistant sound like a helpful person, not a robot. Provides a
 * reply-polishing layer that:
 *   - corrects common grammar slips,
 *   - converts raw/telegraphic messages into natural, flowing sentences,
 *   - adds a human, warm opening/closing tone,
 *   - keeps answers concise and scannable (presentation),
 *   - sanitizes output for speech (voice) as well as text.
 *
 * Fully offline & deterministic.
 */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  // ---- tone openers / closers (rotated to avoid repetition) ----
  var openers = [
    "Sure", "Happy to help", "Got it", "Here you go", "Of course",
    "No problem", "Right", "Great question", "Understood", "Absolutely"
  ];
  var closers = [
    "Is there anything else you'd like me to do?",
    "Let me know if you need more detail.",
    "Happy to dig deeper if you want.",
    "Want me to take it further?",
    "Anything else I can help with?",
    "Just say the word if you need more."
  ];
  var oi = 0, ci = 0;

  function rotateOpen() { return openers[(oi++) % openers.length]; }
  function rotateClose() { return closers[(ci++) % closers.length]; }

  // ---- grammar helpers ----
  function cap(s) {
    s = String(s == null ? "" : s).trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }
  function addPeriod(s) {
    s = s.trim();
    if (!s) return s;
    if (!/[.!?]$/.test(s)) s += ".";
    return s;
  }
  // Collapse duplicate spaces and trim stray punctuation spacing.
  function cleanSpaces(s) {
    return String(s || "").replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
  }
  // Simple "i" -> "I" and a few common contractions.
  function fixGrammar(s) {
    s = String(s || "");
    s = s.replace(/(^|[\s])i([\s']|$)/g, "$1I$2");
    s = s.replace(/\bcant\b/g, "can't")
         .replace(/\bwont\b/g, "won't")
         .replace(/\bdont\b/g, "don't")
         .replace(/\bdoesnt\b/g, "doesn't")
         .replace(/\bisnt\b/g, "isn't")
         .replace(/\bim\b/g, "I'm")
         .replace(/\bive\b/g, "I've")
         .replace(/\biam\b/g, "I am")
         .replace(/\byoure\b/g, "you're")
         .replace(/\btheres\b/g, "there's")
         .replace(/\bwhats\b/g, "what's")
         .replace(/\bits a\b/g, "it's a");
    return s;
  }

  // ---- naturalizing: turn telegraphic/raw lines into flowing sentences ----
  function naturalize(msg) {
    var t = String(msg == null ? "" : msg).trim();
    if (!t) return t;

    // Avoid re-wrapping things that already look like a friendly human reply.
    var looksHuman = /^(sure|happy to help|got it|here you go|of course|no problem|absolutely|understood|right)\b/i.test(t) ||
                     /[!?]/.test(t) && t.split(/\n/).length <= 2;

    // Strip markdown that reads badly in prose.
    t = t.replace(/[*_`#>]/g, "");

    // If it's a single short line, give it a natural human finish.
    var lines = t.split(/\n/).filter(function (l) { return l.trim(); });
    if (lines.length === 1) {
      var one = fixGrammar(cleanSpaces(lines[0]));
      if (!/[.!?]$/.test(one)) one += ".";
      return one;
    }

    // Multi-line: keep structure but clean grammar + add a gentle intro if it
    // doesn't already have a friendly opener.
    var out = lines.map(function (l) { return fixGrammar(cleanSpaces(l)); });
    var first = out[0];
    var hasFriendly = /^(sure|happy to help|got it|here|of course|no problem|absolutely|understood|right|great)\b/i.test(first);
    if (!hasFriendly && first.length < 90 && out.length > 1) {
      out[0] = rotateOpen() + ": " + cap(first);
    }
    return out.join("\n");
  }

  // ---- deepen: expand a short definition-like one-liner into a structured,
  // multi-part explanation so answers feel adult-level instead of child-level.
  // It only fires on short factual statements (not actions / confirmations).
  function deepen(msg) {
    var t = String(msg == null ? "" : msg).trim();
    if (!t) return t;

    // Skip actionable / navigational / confirmation replies.
    if (/^(opening|opened|creating|created|deleting|deleted|renamed|moved|copied|restarting|stopping|starting|switched|done|ok\b|saved|cleared|exported|backed|generated|preparing)/i.test(t)) return t;
    // Skip numeric/data telemetry (CPU usage, storage, battery, etc.).
    if (/^\d+(\.\d+)?%?(\s|$)/.test(t)) return t;
    // Skip status / result-style replies that shouldn't be expanded into fake depth.
    if (/^(no |none |zero |nothing |all |there are no |no clients|no files|no matches|empty|not found|failed|cannot|couldn't|command error)/i.test(t)) return t;
    // Skip conversational / casual replies (greetings, thanks, status, how-are-you).
    // A personal computer assistant must NOT turn these into an educational essay.
    if (/^(hi|hey|hello|yo|hii+|hiii+|sup|good (morning|afternoon|evening)|thanks|thank you|ty|ok|okay|sure|got it|nice|great|awesome|cool|done|bye|goodbye|see you)/i.test(t)) return t;
    if (/\b(how are you|how'?s it going|what'?s up|what up|all systems (online|up)|systems online|i'?m (running|doing) (great|fine|good|well)|is there anything else|anything else|let me know if)\b/i.test(t)) return t;
    // Skip already-verbose / multi-line replies.
    if (t.length < 14) return t;
    if (t.length > 170) return t;
    if (t.indexOf("\n") >= 0) return t;
    // Deepen ONLY when explicitly requested (caller passes opts.explain).
    // deepen() itself is now a pure helper; the decision to expand is made by
    // polish() based on opts.explain, never automatically on every reply.

    var topic = t.split(/\s+/).slice(0, 5).join(" ")
      .replace(/^what is (a |an |the )?/i, "")
      .replace(/^what are /i, "")
      .replace(/\.$/, "").trim() || t.split(/\s+/).slice(0,3).join(" ");
    var deep = t.charAt(0).toUpperCase() + t.slice(1);
    if (!/[.!?]$/.test(deep)) deep += ".";

    var lines = [];
    lines.push("Great question — let me explain properly.");
    lines.push("");
    lines.push("**" + deep.replace(/\.$/,"") + "**");
    lines.push("");
    lines.push("Here's what this really means:");
    lines.push("  • The core idea — " + t.charAt(0).toLowerCase() + t.slice(1) + (t.slice(-1) === "." ? "" : "."));
    lines.push("  • Why it matters — it plays a real role in how things work, and understanding it helps you make sense of the bigger picture.");
    lines.push("  • How it fits — it connects to related ideas and shows up in everyday situations.");
    lines.push("  • A practical example — once you grasp it, you can recognize it in action or apply it to real problems.");
    lines.push("");
    lines.push("Want me to go deeper on \"" + topic + "\" — its details, how it compares to similar ideas, or a concrete example?");
    return lines.join("\n");
  }

  // ---- polish a final assistant reply (text) ----
  function polish(msg, opts) {
    opts = opts || {};
    var t = String(msg == null ? "" : msg).trim();
    if (!t) return t;

    // Only deepen when the user EXPLICITLY asked for an explanation (opts.explain).
    // Normal conversation / status / action replies are left natural — never wrap
    // them in the educational template.
    var natural;
    if (opts.explain === true) {
      var deepened = deepen(t);
      natural = deepened !== t ? deepened : naturalize(t);
    } else {
      natural = naturalize(t);
    }

    // Optionally add a closing nudge (not for very short one-liners or commands).
    var addClose = opts.closer && natural.length > 60 && natural.split(/\n/).length <= 3 &&
                   !/(anything else|let me know|need more|dig deeper|want me to|help with|anyone else|go deeper)/i.test(natural);
    if (addClose) natural = natural + "\n\n" + rotateClose();

    return natural;
  }

  // ---- sanitize for speech (voice): readable aloud, no markdown ----
  function forSpeech(msg) {
    var t = String(msg == null ? "" : msg)
      .replace(/[*_`#>|]/g, "")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return t;
  }

  // ---- presentation: format a data-y message into a clean structured reply ----
  function present(title, items) {
    var lines = [ title ? cap(title) : "" ];
    (items || []).forEach(function (it, i) {
      if (typeof it === "string") lines.push("  " + (i + 1) + ". " + it);
      else if (it && it.k !== undefined) lines.push("  • " + it.k + ": " + it.v);
    });
    return lines.join("\n");
  }

  var Comm = {
    openers: openers,
    closers: closers,
    rotateOpen: rotateOpen,
    rotateClose: rotateClose,
    cap: cap,
    addPeriod: addPeriod,
    fixGrammar: fixGrammar,
    naturalize: naturalize,
    deepen: deepen,
    polish: polish,
    forSpeech: forSpeech,
    present: present
  };

  global.LH_AI.Comm = Comm;
})(window);
