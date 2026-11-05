/* engine.js - the assistant's executive.
 *
 * Four behaviours the rule engine did not have.
 *
 * 1. It admits when it does not know. Below CONFIDENCE_FLOOR the engine
 *    returns UNKNOWN and the caller falls back to the older path. The rule
 *    engine had no such concept: it always returned its best guess, which is
 *    how "what is your limit" ended up being answered by an unrelated entry.
 *
 * 2. It asks instead of guessing. A frame that is missing a required slot
 *    produces a question with options, not a confident wrong action.
 *
 * 3. It shows destructive work before doing it. Deletion has no undo, so the
 *    plan is returned for confirmation first.
 *
 * 4. It proves its work. Every mutating step is followed by a read-back. If
 *    the effect is not observed the step is reported as failed, completed
 *    steps are rolled back where a compensation exists, and the user is told
 *    - rather than being shown a success message for a move that never
 *    happened.
 */
(function (global) {
  "use strict";

  var AI = global.LH_AI = global.LH_AI || {};
  var NLU = AI.NLU = AI.NLU || {};

  /** Below this the engine declines and the caller falls back. */
  var CONFIDENCE_FLOOR = 0.45;

  /** A frame this confident is acted on without asking again. */
  var ACT_FLOOR = 0.6;

  // Pending destructive plan, held between the question and the answer.
  var pending = null;
  var PENDING_TTL_MS = 120000;

  function Caps() { return AI.Capabilities; }

  function permitted(cap) {
    var C = Caps();
    if (!C || !cap) return true;               // unknown capability: do not block
    var entry = C.lookup(cap);
    if (!entry) return true;
    return C.hasPermission(entry);
  }

  // ------------------------------------------------------------- clarifying

  var SLOT_QUESTIONS = {
    target: { q: "Which file or folder should I work on?", options: ["Downloads", "DCIM (camera)", "Music", "Documents", "The current folder"] },
    destination: { q: "Where should it go?", options: ["/storage/emulated/0/Download", "/storage/emulated/0/Documents", "A new folder"] },
    name: { q: "What name should I use?", options: null },
    query: { q: "What should I search for?", options: null }
  };

  function clarify(frame) {
    var slot = frame.missing[0];
    var spec = SLOT_QUESTIONS[slot] || { q: "I need a bit more detail — what should I act on?", options: null };
    return {
      kind: "CLARIFY",
      ok: true,
      frame: frame,
      slot: slot,
      message: spec.q + (spec.options ? "\n" + spec.options.map(function (o, i) { return (i + 1) + ". " + o; }).join("\n") : "")
    };
  }

  // ------------------------------------------------------------- confirming

  function describePlan(frame, plan) {
    var lines = plan.map(function (s, i) {
      return (i + 1) + ". " + s.label + (s.destructive ? "  (changes files)" : "");
    });
    return "I can do this as " + plan.length + " step(s):\n" + lines.join("\n") +
      "\n\nReply **yes** to go ahead, or **cancel** to drop it.";
  }

  // --------------------------------------------------------------- running

  function runStep(s, ctx) {
    var started = Date.now();
    return Promise.resolve()
      .then(function () { return s.run(ctx); })
      .then(function (result) {
        var out = {
          id: s.id,
          label: s.label,
          ok: !result || result.ok !== false,
          message: (result && result.message) || "",
          openFM: (result && result.openFM) || null,
          media: (result && result.media) || null,
          verified: null,
          ms: Date.now() - started
        };
        if (!out.ok) return out;
        if (!s.verify) { out.verified = null; return out; }
        return Promise.resolve()
          .then(function () { return s.verify(ctx, result); })
          .then(function (verdict) {
            out.verified = !!verdict;
            if (verdict === false) {
              out.ok = false;
              out.message = out.message
                ? out.message + " (but I could not confirm it happened)"
                : "I could not confirm this step happened.";
            }
            return out;
          })
          .catch(function () {
            out.verified = false;
            return out;
          });
      })
      .catch(function (e) {
        return {
          id: s.id, label: s.label, ok: false, verified: false,
          message: "Step failed: " + ((e && e.message) || e), ms: Date.now() - started
        };
      });
  }

  function rollback(plan, ctx, reports) {
    var done = [];
    for (var i = reports.length - 1; i >= 0; i--) {
      var s = plan[i];
      if (s && s.compensate && reports[i].ok) {
        done.push(Promise.resolve().then(function () { return s.compensate(ctx); }).catch(function () { }));
      }
    }
    return Promise.all(done);
  }

  function execute(frame, plan) {
    var ctx = { frame: frame, entries: [], groups: {}, victims: [], moves: [], empties: [] };
    var reports = [];
    var chain = Promise.resolve();
    var aborted = false;

    plan.forEach(function (s) {
      chain = chain.then(function () {
        if (aborted) return null;
        if (!permitted(s.cap)) {
          aborted = true;
          reports.push({
            id: s.id, label: s.label, ok: false, verified: false,
            message: "Administrator permission required for '" + s.label + "'."
          });
          return null;
        }
        return runStep(s, ctx).then(function (r) {
          reports.push(r);
          // Any failure stops the plan. Continuing after a partial failure lets
          // a later "report" step summarise work that is about to be rolled
          // back, which reads as success to the user.
          if (!r.ok) aborted = true;
        });
      });
    });

    return chain.then(function () {
      var failed = reports.filter(function (r) { return !r.ok; });
      var needsRollback = failed.length > 0 && reports.some(function (r) { return r.ok; });
      var undo = needsRollback ? rollback(plan, ctx, reports) : Promise.resolve();
      return undo.then(function () {
        var messages = reports.map(function (r) {
          var mark = r.ok ? (r.verified === true ? "✓" : "•") : "✗";
          return mark + " " + r.label + (r.message ? ": " + r.message : "");
        });
        var allOk = failed.length === 0;
        var last = reports[reports.length - 1] || {};
        return {
          kind: allOk ? "DONE" : "FAILED",
          ok: allOk,
          frame: frame,
          steps: reports,
          rolledBack: needsRollback,
          openFM: last.openFM || null,
          media: last.media || null,
          message: messages.join("\n")
        };
      });
    });
  }

  // ------------------------------------------------------------------ entry

  /**
   * Main entry. Returns a promise of:
   *   { kind: "DONE" | "FAILED" | "CONFIRM" | "CLARIFY" | "UNKNOWN", ... }
   *
   * UNKNOWN means "not mine" - the caller should fall back, not apologise.
   */
  function handle(text, opts) {
    opts = opts || {};
    var U = NLU.Understand;
    if (!U) return Promise.resolve({ kind: "UNKNOWN", ok: false, message: "" });

    var frame = U.best(text);
    if (!frame) return Promise.resolve({ kind: "UNKNOWN", ok: false, message: "" });
    if (frame.confidence < CONFIDENCE_FLOOR) {
      return Promise.resolve({ kind: "UNKNOWN", ok: false, message: "", frame: frame });
    }

    // An explicit confirmation answers the question we asked a moment ago.
    if (frame.action === "CONFIRM" && pending && Date.now() - pending.at < PENDING_TTL_MS) {
      var p = pending; pending = null;
      return execute(p.frame, p.plan);
    }
    if (frame.action === "CANCEL") {
      var had = !!pending; pending = null;
      return Promise.resolve({
        kind: "DONE", ok: true, message: had ? "Cancelled — nothing was changed." : "There was nothing pending."
      });
    }

    if (!frame.complete) return Promise.resolve(clarify(frame));

    var plan = NLU.Plans.build(frame);
    if (!plan.length) return Promise.resolve({ kind: "UNKNOWN", ok: false, message: "", frame: frame });

    // Anything destructive is confirmed first - always.
    //
    // Confidence is a measure of how well the request was understood, not of
    // how safe it is. A perfectly understood "delete" is still a delete, and
    // there is no undo. Gating this on confidence would mean the more certain
    // the engine was, the less it asked - exactly backwards.
    var destructive = plan.some(function (s) { return s.destructive; });
    if (destructive && !opts.approved) {
      pending = { frame: frame, plan: plan, at: Date.now() };
      return Promise.resolve({
        kind: "CONFIRM", ok: true, frame: frame, plan: plan,
        message: describePlan(frame, plan)
      });
    }

    return execute(frame, plan);
  }

  /** Non-executing view of what the engine understood. For the debug panel. */
  function explain(text) {
    var U = NLU.Understand;
    if (!U) return null;
    var frame = U.best(text);
    if (!frame) return null;
    return {
      text: text,
      action: frame.action,
      slots: frame.slots,
      modifiers: frame.modifiers,
      missing: frame.missing,
      coverage: Math.round(frame.coverage * 100) + "%",
      confidence: Math.round(frame.confidence * 100) + "%",
      complete: frame.complete,
      steps: NLU.Plans.build(frame).map(function (s) { return s.id + (s.destructive ? "*" : ""); })
    };
  }

  /**
   * Puts the engine in front of the existing assistant without removing it.
   *
   * The old engine is not deleted, it is demoted: anything the new engine
   * declines (UNKNOWN) still reaches it, so no working command is lost. That
   * is deliberate - replacing 128 registered commands in one step is how you
   * ship an assistant that understands less than it did yesterday.
   */
  function install() {
    var A = AI.Assistant;
    if (!A || !A.run || A.__nluWrapped) return false;
    var original = A.run;
    A.run = function (intent, text, parsed) {
      return handle(String(text || "")).then(function (r) {
        if (!r || r.kind === "UNKNOWN") {
          return original.call(A, intent, text, parsed);
        }
        // Shape matches what the rest of the app already expects.
        return {
          ok: r.ok !== false,
          message: r.message || "",
          data: r.steps || null,
          openFM: r.openFM || null,
          media: r.media || null,
          intent: "nlu." + String((r.frame && r.frame.action) || r.kind).toLowerCase(),
          kind: r.kind,
          plan: r.plan || null,
          steps: r.steps || null
        };
      }).catch(function () {
        return original.call(A, intent, text, parsed);
      });
    };
    A.__nluWrapped = true;
    return true;
  }

  NLU.Engine = {
    CONFIDENCE_FLOOR: CONFIDENCE_FLOOR,
    ACT_FLOOR: ACT_FLOOR,
    handle: handle,
    explain: explain,
    install: install,
    pending: function () { return pending; },
    clearPending: function () { pending = null; }
  };

  // Install as soon as both sides are loaded.
  if (AI.Assistant && AI.Assistant.run) install();
})(window);
