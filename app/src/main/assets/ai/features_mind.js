/* features_mind.js - LocalHub Mind: a thinking engine that processes ANY free-form
 * question/task through a reasoning pipeline, like a real assistant's brain.
 *
 * Pipeline:  Classify → Extract Topic → Retrieve Knowledge → Structure →
 *            Reason → Conclude → Natural Reply
 *
 * It complements the command engine: when a query isn't a known command, the
 * Mind engine steps in and thinks about it instead of replying "I didn't recognize".
 * Fully offline & deterministic.
 */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  var Commands = global.LH_AI.Commands;
  var Knowledge = global.LH_AI.Knowledge;
  var Memory = global.LH_AI.Memory;

  // ------------------------------------------------------------------
  // 1. Question classification (what kind of thinking is needed)
  // ------------------------------------------------------------------
  function cap(s) {
    s = String(s == null ? "" : s).trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  function classify(q) {
    var t = String(q || "").toLowerCase();
    if (/\bwhat do you think\b|\bwhat's your opinion\b|\bwhat is your opinion\b|\bdo you agree\b|\bopinion\b/.test(t)) return "opinion";
    if (/\bwill\b|\bpredict\b|\bforecast\b|\bwhat will happen\b|\bin the future\b|\bwho will\b|\bgoing to\b|\bwhat happens if.*in the future\b/.test(t)) return "predict";
    if (/\bsummarize\b|\bsum up\b|\bkey points\b|\bgist\b|\btakeaways\b/.test(t)) return "summarize";
    if (/\bbrainstorm\b|\bcome up with\b|\bsuggest ideas\b|\bgive me ideas\b|\bgenerate.*idea\b/.test(t)) return "brainstorm";
    if (/\bcritique\b|\bwhat is wrong with\b|\bproblems with\b|\bflaws\b|\bweakness.*(argument|idea|plan)\b/.test(t)) return "critique";
    if (/\bgive me a plan\b|\bcreate a plan\b|\bplan for\b|\bwhat should i do (to|about|if)\b|\bgive me a roadmap\b/.test(t)) return "plan";
    if (/(\bwhy\b|\bcause\b|\breason\b|\bbecause\b)/.test(t)) return "cause";
    if (/\bcompare\b|\bvs\b|\bversus\b|\bdifference between\b|\bwhich is better\b|\bpros and cons\b/.test(t)) return "compare";
    if (/\bhow do i\b|\bhow to\b|\bhow can i\b|\bhow would\b|\bhelp me\b|\bsolve\b|\bfix\b|\bhow do you\b/.test(t)) return "how";
    if (/\bwhat if\b|\bif.*then\b|\bscenario\b|\bimagine\b/.test(t)) return "scenario";
    if (/\bshould i\b|\bevaluate\b|\bdecision\b|\bworth it\b/.test(t)) return "decision";
    if (/\bverify\b|\bis it true\b|\bcheck if\b|\baccurate\b|\bfact[- ]check\b|\bproof\b/.test(t)) return "verify";
    if (/\brisk\b|\bdanger\b|\bwhat could go wrong\b/.test(t)) return "risk";
    if (/\bdefine\b|\bwhat is\b|\bwhat are\b|\bmeaning\b|\bwhat does\b|\bexplain\b/.test(t)) return "define";
    if (/\bwhen\b|\bhow long\b|\bhow often\b/.test(t)) return "when";
    if (/\bhow does\b|\bhow work\b|\bprocess\b|\bmechanism\b|\bstep\b|\bsequence\b/.test(t)) return "how-work";
    if (/\bwhich\b|\bwho\b|\bwhere\b|\bhow many\b|\bhow much\b|\bwhat is the\b/.test(t)) return "fact";
    return "explain";
  }

  // ------------------------------------------------------------------
  // 2. Extract the topic (remove question words / stop words)
  // ------------------------------------------------------------------
  var STOP = new Set(("the a an is are was were be to of in on at for with by as from about and or but if then when where who which what why how do does did can could should would will may might not no yes me you it its this that these those please tell explain describe define mean meaning difference between pros cons advantage disadvantage worth evaluate reason cause because give make learn know want need").split(" "));

  function extractTopic(q) {
    var t = String(q || "").toLowerCase()
      .replace(/[?!.,]/g, " ")
      .replace(/\b(please|could you|can you|would you|tell me|explain to me|explain me|let me know)\b/g, " ");
    var words = t.split(/\s+/).filter(function (w) {
      return w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w) && !/^(android|ios|phone|phone|make|get|have|like|good|bad)$/.test(w);
    });
    // Keep up to 5 meaningful words as the topic signature (longest/rarest first-ish).
    return words.slice(0, 5).join(" ");
  }

  // ------------------------------------------------------------------
  // 3. Knowledge retrieval: find matching KB entries about the topic
  // ------------------------------------------------------------------
  function retrieveFacts(topic, question) {
    // 1) Custom knowledge store (knowledge.js) if present.
    var fromStore = (Knowledge && Knowledge.all)
      ? Promise.resolve(Knowledge.all()).then(function (all) {
          var topicWords = topic.split(/\s+/).filter(function (w) { return w.length > 2; });
          if (!topicWords.length) return [];
          var scored = [];
          all.forEach(function (e) {
            var hay = ((e.title || "") + " " + (e.content || "")).toLowerCase();
            var title = (e.title || "").toLowerCase();
            var score = 0;
            topicWords.forEach(function (w) {
              if (title.indexOf(w) >= 0) score += 2;
              else if (hay.indexOf(w) >= 0) score += 1;
            });
            if (score > 0) scored.push({ e: e, score: score });
          });
          scored.sort(function (a, b) { return b.score - a.score; });
          return scored.slice(0, 3).map(function (s) { return { title: s.e.title, content: s.e.content }; });
        })
      : Promise.resolve([]);

    // 2) The built-in knowledge base: try to run "what is <topic>" through the
    //    command engine and capture the definition message.
    var fromCommands = Promise.resolve().then(function () {
      if (!Commands || !Commands.parse || !Commands.execute) return [];
      var out = [];
      // Try parsing the whole question first (some are directly a knowledge query).
      var candidates = [question, "what is " + topic, "define " + topic, "explain " + topic];
      var seen = {};
      function tryRun(q) {
        var parsed = Commands.parse(q);
        if (!parsed || !parsed.command) return;
        var cat = parsed.command.category || "";
        // Only pull from knowledge / definition-ish commands, and skip generic noise.
        if (cat !== "know" && cat !== "deep-know") return;
        var key = parsed.command.name;
        if (seen[key]) return;
        seen[key] = 1;
        var res = Commands.execute({ command: parsed.command, text: q });
        if (res && res.then) {
          res.then(function (r) {
            if (r && r.message) out.push({ title: parsed.command.name.replace(/^k-|^know[x0-9]*[-]?/, ""), content: r.message });
          });
        } else if (res && res.message) {
          out.push({ title: parsed.command.name.replace(/^k-|^know[x0-9]*[-]?/, ""), content: res.message });
        }
      }
      candidates.forEach(tryRun);
      return out;
    });

    return Promise.all([fromStore, fromCommands]).then(function (parts) {
      var combined = [];
      var seenTitle = {};
      parts.forEach(function (arr) {
        arr.forEach(function (f) {
          var t = (f.title || "").toLowerCase();
          if (seenTitle[t]) return;
          seenTitle[t] = 1;
          combined.push(f);
        });
      });
      return combined.slice(0, 3);
    });
  }

  // ------------------------------------------------------------------
  // 4. Build a structured reasoned reply per question type
  // ------------------------------------------------------------------
  function factsLines(facts) {
    if (!facts || !facts.length) return [];
    return facts.map(function (f, i) {
      return "  " + (i + 1) + ". " + (f.title || "Topic") + " — " + (f.content || "");
    });
  }

  function buildAnswer(type, topic, question, facts) {
    var lines = [];
    var factText = factsLines(facts);
    var t = topic || "that";

    switch (type) {
      case "define":
        if (factText.length) {
          // Build a richer, multi-part explanation even from a compact fact.
          lines.push(cap(t) + ":");
          lines = lines.concat(factText);
          lines.push("");
          lines.push("To understand it fully:");
          lines.push("  • What it is — the core idea (above).");
          lines.push("  • Why it matters — it solves a real problem or explains something important.");
          lines.push("  • How it fits — it connects to related concepts and everyday use.");
          lines.push("  • Example — a concrete case makes it click.");
          lines.push("");
          lines.push("If you want, I can go deeper on \"" + t + "\" — its history, how it works in detail, or how it compares to related ideas.");
        } else {
          lines.push("About \"" + t + "\": I don't have a stored definition for this exact term, but here's how to think about it —");
          lines.push("  1. What it is: define its core nature.");
          lines.push("  2. Why it matters: the problem it solves.");
          lines.push("  3. How it works: the mechanism behind it.");
          lines.push("  4. An example to make it concrete.");
          lines.push("  5. What it is NOT (to avoid confusion).");
          lines.push("Give me a hint about which area this is (science, coding, finance, health...), and I can give a sharper definition.");
        }
        break;

      case "cause":
        if (factText.length) {
          lines.push("Reasoning about \"" + t + "\" (cause → effect):");
          lines = lines.concat(factText);
          lines.push("");
          lines.push("Think of it as: causes → phenomenon → effects. To get to the root, keep asking \"why\" a few times. Tell me the specific situation and I'll trace the cause chain.");
        } else {
          lines.push("To understand the cause of \"" + t + "\", work through this: ");
          lines.push("  1. What is the observed symptom/effect?");
          lines.push("  2. What is the immediate cause?");
          lines.push("  3. What is the underlying/root cause?");
          lines.push("  4. What feedback loop (if any) keeps it going?");
          lines.push("Describe the situation and I'll help you follow the \"5 Whys\" to the root cause.");
        }
        break;

      case "how":
        if (factText.length) {
          lines.push("For \"" + t + "\", here's a path I'd take:");
          lines = lines.concat(factText);
          lines.push("");
          lines.push("General approach: 1) Define the goal. 2) Break it into steps. 3) Do the first small step. 4) Review and adjust. I can give you specific steps if you tell me the exact thing you want to do.");
        } else {
          lines.push("Here's a reliable way to approach \"" + t + "\":");
          lines.push("  1. Clarify exactly what you want as the end result.");
          lines.push("  2. List what you already have / the constraints.");
          lines.push("  3. Break it into 3-5 small steps.");
          lines.push("  4. Do the easiest step first to build momentum.");
          lines.push("  5. Check progress, then continue.");
          lines.push("Tell me the specific task and I'll turn this into concrete steps.");
        }
        break;

      case "compare":
        if (factText.length) {
          lines.push("Comparing aspects of \"" + t + "\":");
          lines = lines.concat(factText);
        }
        lines.push("To compare fairly: 1) list what each side IS, 2) find similarities, 3) find key differences, 4) weigh pros/cons of each, 5) decide based on what matters most to you. Name the two things and I'll structure the comparison.");
        break;

      case "scenario":
        if (factText.length) {
          lines.push("Thinking through the scenario around \"" + t + "\":");
          lines = lines.concat(factText);
        }
        lines.push("Scenario thinking: 1) state the premise, 2) direct consequences, 3) second-order effects, 4) who/what is affected, 5) most likely outcome, 6) how to prepare. Give me the full scenario and I'll walk through it.");
        break;

      case "decision":
        if (factText.length) {
          lines.push("Weighing a decision about \"" + t + "\":");
          lines = lines.concat(factText);
        }
        lines.push("Decision method: 1) define the goal, 2) list options, 3) pros of each, 4) cons of each, 5) weigh what matters most (cost/time/quality/risk), 6) choose, 7) note what would change your mind. Tell me the options and I'll help you score them.");
        break;

      case "verify":
        if (factText.length) {
          lines.push("Checking \"" + t + "\": here's what I have on file:");
          lines = lines.concat(factText);
        }
        lines.push("To verify any claim: 1) restate it precisely, 2) what would prove it, 3) what would disprove it, 4) find the original source, 5) check for bias, 6) cross-check 2-3 sources, 7) conclude: supported / unsupported / uncertain.");
        break;

      case "risk":
        if (factText.length) {
          lines.push("Assessing risk around \"" + t + "\":");
          lines = lines.concat(factText);
        }
        lines.push("Risk assessment: 1) list possible failures, 2) likelihood (high/med/low), 3) impact (high/med/low), 4) risk = likelihood × impact, 5) mitigations, 6) the biggest risk to watch. Tell me the plan and I'll assess it.");
        break;

      case "when":
        if (factText.length) {
          lines.push("About \"" + t + "\":");
          lines = lines.concat(factText);
        }
        lines.push("Timing questions depend on context. Tell me what event/thing and I'll help figure out when or how often it happens, and what signs to look for.");
        break;

      case "how-work":
        if (factText.length) {
          lines.push("How \"" + t + "\" works:");
          lines = lines.concat(factText);
        }
        lines.push("To explain how something works: 1) state the goal/output, 2) the inputs, 3) the ordered steps, 4) what can go wrong, 5) how to verify the result. Tell me the thing and I'll walk through its mechanism step by step.");
        break;

      case "fact":
        if (factText.length) {
          lines.push("Regarding \"" + t + "\":");
          lines = lines.concat(factText);
        } else {
          lines.push("I couldn't find a stored fact for \"" + t + "\". Tell me which domain (science, tech, geography, history, etc.) and I'll either recall it or help you verify it.");
        }
        break;

      case "opinion":
        if (factText.length) { lines.push("My take on \"" + t + "\" (based on what I know):"); lines = lines.concat(factText); }
        lines.push("To form a balanced opinion I'd weigh: 1) the facts, 2) different viewpoints, 3) who's affected, 4) short vs long term, 5) what matters most to you. My position is a starting point — tell me more and I can refine it.");
        break;

      case "predict":
        if (factText.length) { lines.push("Thinking forward about \"" + t + "\":"); lines = lines.concat(factText); }
        lines.push("Prediction isn't certainty. I'd reason: 1) current trends, 2) likely forces, 3) what could break the trend, 4) most-likely vs wild-card outcomes, 5) confidence level. The future has many paths — here's the most probable one, not a guarantee.");
        break;

      case "summarize":
        lines.push("Let me summarize \"" + t + "\":");
        if (factText.length) lines = lines.concat(factText);
        lines.push("A good summary: 1) one-line main idea, 2) 2-4 supporting points, 3) one takeaway/action, 4) what to ignore. Paste the text/topic and I'll condense it into these essentials.");
        break;

      case "brainstorm":
        if (factText.length) { lines.push("Ideas related to \"" + t + "\":"); lines = lines.concat(factText); }
        lines.push("Brainstorming rules: 1) quantity over quality first, 2) no judging, 3) build on others' ideas, 4) combine & remix, 5) then filter. Give me the goal and I'll generate a spread of ideas across categories.");
        break;

      case "critique":
        if (factText.length) { lines.push("Critically examining \"" + t + "\":"); lines = lines.concat(factText); }
        lines.push("Fair critique: 1) what it claims, 2) the evidence, 3) hidden assumptions, 4) counter-arguments, 5) what's actually strong, 6) what's weak, 7) a balanced verdict. Share the idea/argument and I'll critique it constructively.");
        break;

      case "plan":
        if (factText.length) { lines.push("Planning for \"" + t + "\":"); lines = lines.concat(factText); }
        lines.push("A solid plan: 1) the goal, 2) current situation, 3) 3-5 key steps, 4) resources/constraints, 5) timeline, 6) risks & backups, 7) first action today. Tell me the goal and I'll draft a roadmap.");
        break;

      default: // explain
        if (factText.length) {
          lines.push("Let me explain \"" + t + "\":");
          lines = lines.concat(factText);
        }
        lines.push("To understand anything deeply: 1) big picture in one line, 2) what it is, 3) why it matters, 4) how it works, 5) a concrete example, 6) an analogy, 7) what's often misunderstood. Tell me the topic and I'll explain it from the ground up.");
        break;
    }

    return lines.join("\n");
  }

  // ------------------------------------------------------------------
  // 5. Public API
  // ------------------------------------------------------------------
  // A short "human-mind" reflection appended to a reply: names the reasoning
  // used, flags uncertainty honestly, and invites a follow-up. This makes the
  // answer feel considered rather than canned.
  function reflectOn(type, topic, hasFacts) {
    var line = "";
    switch (type) {
      case "cause": line = "I reasoned from causes to effects, but root causes can be nested — a different \u201Cwhy\u201D level can change the answer."; break;
      case "compare": line = "My comparison leans on what's on record; your priorities decide which is better for you."; break;
      case "how": line = "These steps are a general path — the exact order may vary with your situation."; break;
      case "scenario": line = "This is a reasoned guess, not a prediction — small changes in the premise can shift the outcome."; break;
      case "decision": line = "I've laid out the trade-offs; the \u201Cbest\u201D choice depends on what you value most."; break;
      case "verify": line = "I can flag how to check a claim, but I can't browse live sources here — always confirm against a trusted source."; break;
      case "risk": line = "Risk is probability × impact; my list helps you think, but real numbers need your context."; break;
      case "opinion": line = "That's my reasoning, not absolute truth — I'm happy to argue the other side if you want a devil's advocate."; break;
      case "predict": line = "Predictions carry real uncertainty; treat this as one plausible path, not a guarantee."; break;
      case "brainstorm": line = "Ideas are a starting set — the best one often comes from combining two of these."; break;
      case "critique": line = "My critique balances strengths and weaknesses; a different frame could shift the verdict."; break;
      case "plan": line = "A plan is only useful if you take the first step — which one can you start today?"; break;
      default: line = hasFacts ? "I've grounded this in what I know, but context can change the picture — ask me to go deeper or take a different angle." : "I don't have this memorized, so I've reasoned from general principles — tell me more and I'll sharpen it.";
    }
    return "\n\n\u2014 A thought on the thinking: " + line + " Want me to go deeper, or look at it from another angle?";
  }


  // ------------------------------------------------------------------
  // SELF-AWARENESS: detect and answer questions ABOUT the assistant itself.
  // If the user asks "what is your limit", "what can you do", "who are you",
  // etc. (referring to "you/your/yourself"), the assistant answers about
  // ITSELF instead of the dictionary definition of a stray keyword.
  // ------------------------------------------------------------------
  var SelfAware = {
    // Keywords that signal a question is about the assistant (not a topic).
    selfHints: ["you", "your", "yourself", "yourself?"],

    isSelfQuery: function (q) {
      var t = String(q || "").toLowerCase();
      // Definitely about the assistant if it asks about you/your directly
      // and isn't an unrelated command phrase.
      if (/\b(you|your|yourself)\b/.test(t) &&
          /\b(are|do|can|what|who|how|limit|limitation|capab|skill|know|name|made|built|think|feel|remember|understand|power|feature|goal|purpose|mission|aim|do for me|version|spec|specification|language|architecture|brain|memory|self[ -]?heal|routine|files|made of|written in|built with|tech|stack|programmed|what is it|what are you made)\b/.test(t)) {
        return true;
      }
      // "who are you", "what are you", "are you" forms.
      if (/\b(who are you|what are you|are you (a|an|real|human|robot|ai|offline|local)|what is your name|your name)\b/.test(t)) return true;
      return false;
    },

    // Returns a Promise<string> for a self-query, or null if not handled.
    answer: function (q) {
      var t = String(q || "").toLowerCase();

      // GOAL / PURPOSE / MISSION
      if (/\b(your|what is your|what's your) (goal|purpose|mission|aim)\b/.test(t)) {
        return Promise.resolve(
          "My goal is to be your reliable local assistant: to help you manage and understand your LocalHub, " +
          "keep it running smoothly (and even fix issues on its own), answer questions with real depth, reason through " +
          "problems, and make everything feel effortless. I aim to be fast, private, offline, and genuinely useful — " +
          "always under your control. Tell me what you'd like to accomplish and I'll do my best to help you reach it."
        );
      }

      // LIMITS / LIMITATIONS
      if (/\b(limit|limitation|can't|cannot|what can't you do|what can you not do|what are you not able)\b/.test(t)) {
        return Promise.resolve(
          "Honestly, I have clear limits. I'm a local, offline assistant that runs entirely on your phone — " +
          "I don't browse the live internet, so I can't fetch current news, weather, or up-to-date facts. " +
          "I can't remember things across a reset, I only act on what's allowed on your device, and I won't do " +
          "harmful, deceptive, or malicious things. Within LocalHub — files, media, server, system, coding help, " +
          "math, reasoning, and thousands of commands — I'm quite capable. But I'm deterministic and rule-based, " +
          "not a general creative AI."
        );
      }

      // VERSION
      if (/\b(your|the )?version\b/i.test(t) && /(version|version of you|what version)/i.test(q)) {
        return Promise.resolve(
          "I'm LocalHub, currently on the v2.22.x assistant engine (Android app build 1.0.0). " +
          "Everything I do runs locally and offline on your device."
        );
      }

      // SPECIFICATION / ARCHITECTURE / HOW BUILT / LANGUAGE
      if (/\b(spec|specification|architecture|tech ?stack|stack|built with|written in|made of|programming language|language .* make you|make you|coding language|what (language|tech|stack))\b/i.test(t)) {
        return Promise.resolve(
          "I'm the LocalHub assistant, built as a deterministic, offline, local system. My app is written in " +
          "Kotlin with Jetpack Compose on Android, with a NanoHTTPD HTTP server and a JavaScript assistant engine " +
          "(the commands, Cognitive Core, PersonalBrain, routines, and self-healing logic are all JavaScript that " +
          "runs on-device). I have no cloud dependency — everything runs on your phone."
        );
      }

      // CAPABILITIES / WHAT CAN YOU DO
      if (/\b(can you do|what can you do|what do you do|capab|skills?|what are you good at|your features?|your powers?|your capabilities)\b/.test(t)) {
        return Promise.resolve(
          "I'm your LocalHub assistant. I can control your phone's LocalHub server — open and manage files, play media, " +
          "show system stats (CPU, RAM, storage, battery), control the server (restart/stop/start), manage network and devices, " +
          "and run automations. I also do math, unit conversions, answer questions across thousands of topics, reason through " +
          "problems with critical thinking, help with coding, explain concepts deeply, and speak replies aloud with the phone's voice. " +
          "Everything is offline and private. Try 'help' to see more, or ask me to 'open downloads', 'show cpu usage', 'restart server'."
        );
      }

      // WHO ARE YOU / IDENTITY
      if (/\b(who are you|what are you|your name|what is your name|are you (a robot|human|real|ai|offline|local|free))\b/.test(t)) {
        return Promise.resolve(
          "I'm the LocalHub OS assistant — a local, offline, deterministic assistant that lives inside your phone's LocalHub server. " +
          "I'm not connected to the cloud; everything runs on your device. I'm rule-based rather than a general AI, " +
          "which means I'm fast, private, predictable, and fully under your control. I help you manage LocalHub and answer questions."
        );
      }

      // BRAIN / COGNITIVE
      if (/\b(your |the )?(brain|cognitive|mind)\b/i.test(t)) {
        return Promise.resolve(
          "My 'brain' is the LocalHub Cognitive Core plus a PersonalBrain. The Cognitive Core handles perception, " +
          "memory (working, episodic, semantic, procedural), attention, focus, goals, decision-making, and self-model. " +
          "The PersonalBrain adds personal memory, routines, habits, prediction, and proactive assistance — all local " +
          "and deterministic, with no cloud."
        );
      }

      // MEMORY / REMEMBER
      if (/\b(can you (remember|recall)|do you (remember|recall)|your memory|what do you remember|how does your memory)\b/.test(t)) {
        return Promise.resolve(
          "I have a local Memory system. I can remember things you ask me to store (say 'remember <something>'), " +
          "keep notes, track tasks, and hold a knowledge base. But my memory is stored on your device — it's not sent anywhere, " +
          "and it can be cleared. I don't have a continuous conversation memory across a reset unless you save it."
        );
      }

      // SELF-HEALING
      if (/\b(self[ -]?heal|heal (yourself|itself)|fix yourself|repair yourself|how do you fix)\b/i.test(t)) {
        return Promise.resolve(
          "LocalHub has a Self-Healing engine (SelfHeal). It detects failures, investigates root causes, and can propose " +
          "patches — with backup, rollback, and automatic recovery — all under safety gates and your approval. It repairs " +
          "real software issues deterministically and never bypasses security."
        );
      }

      // ROUTINES / AUTOMATION
      if (/\b(routine|routines|your routine)\b/i.test(t)) {
        return Promise.resolve(
          "I can learn your routines: I watch for repeated workflows and, with your approval, turn them into routines I " +
          "can run for you automatically in the right context. Ask 'show my routines' to see them."
        );
      }

      // HOW DO YOU WORK / THINK
      if (/\b(how do you (work|think|answer|remember|understand|process)|how are you made|how were you built|your thinking)\b/.test(t)) {
        return Promise.resolve(
          "Here's how I work: when you ask something, I first check if it matches one of my thousands of commands. " +
          "If it's a free-form question, my 'Mind' engine classifies it (define, cause, compare, decide, etc.), extracts the topic, " +
          "pulls what I know from my knowledge base, applies the right reasoning method, and builds a structured answer. " +
          "I'm deterministic — the same question gets the same answer — and everything runs locally on your phone, no cloud."
        );
      }

      // THINK / FEEL
      if (/\b(do you (think|feel|dream|understand)|can you (think|feel|understand)|do you have (feelings|emotions|a soul))\b/.test(t)) {
        return Promise.resolve(
          "I can reason and 'process' questions using my Mind engine, but I don't feel emotions or have consciousness. " +
          "I analyze, weigh options, and explain reasoning — but I do that deterministically, not by feeling. " +
          "Think of me as a very capable reasoning tool, not a sentient being."
        );
      }

      // PRIVACY / OFFLINE / DATA
      if (/\b(are you (offline|local|private)|do you (send|share|leak|use internet)|is my data safe|are you connected to cloud)\b/.test(t)) {
        return Promise.resolve(
          "Yes — I'm fully offline and local. I run inside your phone's LocalHub server, and nothing you ask is sent to the internet. " +
          "Your data, files, and chat history stay on your device and your LAN. I don't use cloud AI or third-party services."
        );
      }

      // WHY DO YOU TALK LIKE THIS / STYLE
      if (/\b(why do you (talk|answer|respond) like|your tone|your style|how should you talk)\b/.test(t)) {
        return Promise.resolve(
          "I aim to sound like a helpful person rather than a robot: I open warmly, use natural grammar, structure multi-point answers, " +
          "and offer to help further. You can ask me to be more formal, casual, concise, or detailed, and I'll adjust."
        );
      }

      return null;
    }
  };

  var Mind = {
    classify: classify,
    isSelfQuery: function (q) { return SelfAware.isSelfQuery(q); },
    answer: function (q) { return SelfAware.answer(q); },
    extractTopic: extractTopic,

    // The full thinking pipeline: returns a Promise of {ok, message, type, topic}
    think: function (question) {
      var q = String(question || "").trim();
      if (!q) return Promise.resolve({ ok: true, message: "What would you like me to think about?" });
      // Self-awareness first: if the question is about the assistant itself
      // ("what is your limit", "who are you", "what can you do"...), answer
      // about ME, not the dictionary meaning of a keyword.
      if (SelfAware.isSelfQuery(q)) {
        var selfAns = SelfAware.answer(q);
        if (selfAns) {
          return Promise.resolve(selfAns).then(function (m) {
            return { ok: true, message: m, type: "self", topic: "me" };
          });
        }
        // A self-referential question that isn't a recognized branch must NOT
        // fall back to the dictionary meaning of a stray keyword. Give a natural
        // self answer instead.
        return Promise.resolve({
          ok: true,
          message: "I'm the LocalHub assistant — a local, offline, deterministic assistant running on your device. " +
            "Ask me 'what can you do' for my capabilities, or tell me what you'd like help with.",
          type: "self", topic: "me"
        });
      }
      var type = classify(q);
      var topic = extractTopic(q);
      return retrieveFacts(topic, q).then(function (facts) {
        var message = buildAnswer(type, topic, q, facts);
        // Append the human-mind reflection (except for pure factual replies).
        if (type !== "fact" && type !== "define" || type === "define" && !facts.length) {
          message = message + reflectOn(type, topic, facts.length > 0);
        }
        return { ok: true, message: message, type: type, topic: topic };
      });
    },

    // Convenience used by commands
    process: function (question) {
      return Mind.think(question);
    }
  };

  global.LH_AI.Mind = Mind;
// ---- Mind commands: explicit invocations of the thinking engine ----
(function(){
  var C = global.LH_AI.Commands;
  if (!C) return;
  function reg(name, phrases, type){
    C.register({ module:"mind", category:"mind", name:name, match:phrases.map(function(p){return new RegExp(p,"i");}), admin:false,
      run:function(text){ return global.LH_AI.Mind ? global.LH_AI.Mind.think(text) : Promise.resolve({ok:true,message:"Mind engine not loaded."}); } });
  }
  reg("mind-think",["^mind[,:]? (.*)","^think( about)?:? (.*)","^reason( about)?:? (.*)","^analyze:? (.*)","^process:? (.*)","^what do you think about (.*)","^consider:? (.*)"]);
})();

})(window);

/* -- Self-awareness commands (so self-queries win in the command parser too) -- */
(function(){
  var C = global.LH_AI.Commands;
  if (!C) return;
  var M = global.LH_AI.Mind;
  function selfRun(){
    var ans = M && M._self || null;
    if (ans) return Promise.resolve({ ok:true, message: ans });
    return Promise.resolve({ ok:true, message:"I'm your LocalHub assistant. Ask 'what can you do' for my capabilities." });
  }
  // Provide a direct self-answer accessor on Mind so these commands can use it.
  M._answerSelf = function(q){ return M ? M.process(q) : Promise.resolve({ok:true,message:""}); };
  C.register({module:"mind",category:"self",name:"self-limits",deep:true,
    match:[/\bwhat(?: is| are)? your (limit|limitations?)\b/i,/\bwhat can't you do\b/i,/\bwhat can you not do\b/i,/\b(?:are|what) (?:your|you) limits?\b/i],
    admin:false, run:function(t){ return M.process(t); }});
  C.register({module:"mind",category:"self",name:"self-capabilities",deep:true,
    match:[/\bwhat can you do\b/i,/\bwhat do you do\b/i,/\byour capabilities?\b/i,/\bwhat are you good at\b/i,/\byour features?\b/i,/\bwhat are your skills?\b/i,/\byour powers?\b/i],
    admin:false, run:function(t){ return M.process(t); }});
  C.register({module:"mind",category:"self",name:"self-identity",deep:true,
    match:[/\bwho are you\b/i,/\bwhat are you\b/i,/\bwhat is your name\b/i,/\bwhat should i call you\b/i,/\bare you (a robot|human|real|ai|an ai)\b/i],
    admin:false, run:function(t){ return M.process(t); }});
  C.register({module:"mind",category:"self",name:"self-how-work",deep:true,
    match:[/\b(how|why) do you (work|think|answer|remember|understand|process|talk|respond|behave)\b/i,/\bhow are you (made|built)\b/i,/\bwhy do you talk like (that|this)\b/i],
    admin:false, run:function(t){ return M.process(t); }});
  C.register({module:"mind",category:"self",name:"self-memory",deep:true,
    match:[/\b(can|do) you (remember|recall)\b/i,/\byour memory\b/i,/\bwhat do you remember\b/i],
    admin:false, run:function(t){ return M.process(t); }});
  C.register({module:"mind",category:"self",name:"self-feel",deep:true,
    match:[/\bdo you (have )?(feelings|emotions|a soul)\b/i,/\b(can|do) you (feel|feel emotions|dream|understand|think)\b/i],
    admin:false, run:function(t){ return M.process(t); }});
  C.register({module:"mind",category:"self",name:"self-offline",deep:true,
    match:[/\bare you (offline|local|private)\b/i,/\bdo you (use|need) (internet|cloud)\b/i,/\bdo you (send|share|leak) (data|my data)\b/i,/\bis my data safe\b/i,/\bare you connected to (internet|cloud)\b/i],
    admin:false, run:function(t){ return M.process(t); }});
})();
