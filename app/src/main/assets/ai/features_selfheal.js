/* features_selfheal.js - Self-Healing assistant commands. */
(function (global) {
  "use strict";
  var C = global.LH_AI.Commands;
  if (!C) return;
  var SH = global.LH_AI.SelfHeal;
  var Cog = global.LH_AI.Cognitive;

  function sh(fn) {
    return SH && fn ? fn() : Promise.resolve({ ok: true, message: "Self-healing engine not loaded." });
  }

  // --- self diagnostic ---
  C.register({ module: "selfheal", category: "selfheal", name: "self-diagnose", deep: true,
    match: [/\b(diagnos|self[- ]?diagnos|run (a |the )?diagnostic|check (for )?(issues|problems|errors|bugs))\b/i,
            /\bwhy (is|are) .* failing\b/i, /\bkeeps? failing\b/i, /\bfind (the )?bug\b/i, /\binvestigate\b/i],
    admin: true, run: function () { return sh(function () { return SH.selfDiagnose(); }); } });

  // --- report an incident ---
  C.register({ module: "selfheal", category: "selfheal", name: "report-incident", deep: true,
    match: [/\breport (a |an )?(bug|incident|error|problem)\b/i, /\bopen (an |a )?incident\b/i, /\bsomething (is )?(broken|wrong)\b/i],
    admin: true, run: function (text) {
      return sh(function () {
        return SH.handleDetection({ component: "user-reported", error: String(text || "").slice(0, 120), severity: "medium", frequency: 1 });
      });
    } });

  // --- list incidents ---
  C.register({ module: "selfheal", category: "selfheal", name: "list-incidents", deep: true,
    match: [/\b(show|list|view) (incidents|bugs|issues)\b/i, /\bincident (status|history)\b/i, /\bwhat went wrong\b/i],
    admin: true, run: function () {
      return sh(function () {
        return SH.listIncidents().then(function (list) {
          if (!list.length) return { ok: true, message: "No incidents recorded." };
          var lines = ["📋 Incidents (" + list.length + "):", ""];
          list.slice(0, 15).forEach(function (i) {
            lines.push("• " + i.incidentId + " [" + i.state + "] " + i.component + ": " + String(i.error).slice(0, 60));
          });
          return { ok: true, message: lines.join("\n") };
        });
      });
    } });

  // --- approve / deploy a proposed fix ---
  C.register({ module: "selfheal", category: "selfheal", name: "approve-fix", deep: true,
    match: [/\bapprove (the )?(fix|patch|repair)\b/i, /\bdeploy (the )?(fix|patch)\b/i, /\bapply (the )?fix\b/i],
    admin: true, run: function () {
      return sh(function () {
        return SH.listIncidents().then(function (list) {
          var pending = list.filter(function (i) { return i.state === "proposing" && i.candidateFix; });
          if (!pending.length) return { ok: true, message: "No proposed fixes awaiting approval. Run 'diagnose' or report an incident first." };
          var inc = pending[0];
          inc.state = "deploying"; inc.deploymentStatus = "deploying";
          // Backup then (in sandbox) mark that real deployment needs the SDK.
          return SH.backupState().then(function (bak) {
            inc.deploymentStatus = "backed_up";
            return SH.testPatch(inc.candidateFix).then(function (tres) {
              if (!tres.ok) { inc.state = "rejected"; return { ok: false, message: "Fix rejected — tests failed." }; }
              inc.state = "resolved"; inc.deploymentStatus = "deployed"; inc.rollbackStatus = "not_needed";
              SH.rememberIncidentKnowledge(inc, inc.candidateFix.reason, "success");
              SH.addRegressionTest(inc, ["component-operates", "no-404", "no-500"]);
              return { ok: true, message: "Fix approved. Root cause: " + ((inc.rootCause && inc.rootCause.causes[0]) || "—") + ". Patch " + inc.candidateFix.patchId + " marked deployed. (On-device binary deploy requires the Android build; the fix plan + regression tests are recorded.)" };
            });
          });
        });
      });
    } });

  // --- rollback ---
  C.register({ module: "selfheal", category: "selfheal", name: "rollback", deep: true,
    match: [/\brollback\b/i, /\bundo (the )?(fix|patch)\b/i, /\brestore (the )?(backup|last good)\b/i],
    admin: true, run: function () {
      return sh(function () {
        return SH.listBackups().then(function (baks) {
          if (!baks.length) return { ok: true, message: "No backups to restore." };
          var latest = baks[baks.length - 1];
          return SH.rollback(latest).then(function (r) {
            return { ok: r.ok, message: r.message + " (backup " + latest.backupId + ")" };
          });
        });
      });
    } });

  // --- self-healing status ---
  C.register({ module: "selfheal", category: "selfheal", name: "heal-status", deep: true,
    match: [/\bself[- ]?heal(ing)? (status|on|active|enabled)\b/i, /\bwhat is self[- ]?heal(ing)\b/i],
    admin: true, run: function () {
      return sh(function () {
        return SH.listIncidents().then(function (list) {
          var open = list.filter(function (i) { return i.state !== "resolved" && i.state !== "rejected"; }).length;
          var learned = list.filter(function (i) { return i.state === "resolved"; }).length;
          return {
            ok: true, message: "🛠 Self-Healing Engine: model=" + SH.modelProvider.kind +
              ", open incidents=" + open + ", learned=" + learned +
              ". It auto-recovers only safe, tested, non-critical issues; critical/uncertain changes always need your approval."
          };
        });
      });
    } });

  // --- goals ---
  C.register({ module: "selfheal", category: "selfheal", name: "goal", deep: true,
    match: [/\b(set|create|add) (a |the )?goal\b/i, /\bmy (current )?goal\b/i, /\bcontinue (the )?(goal|task)\b/i],
    admin: false, run: function (text) {
      var goal = (Cog && Cog.getGoal) ? Cog.getGoal() : null;
      if (/\bcontinue\b/i.test(text)) { return (Cog && Cog.continueGoal) ? Cog.continueGoal() : Promise.resolve({ ok: true, message: "No active goal." }); }
      if (/current|my/i.test(text)) {
        return Promise.resolve({ ok: true, message: goal ? ("Current goal: " + goal.label + " (state: " + goal.state + "). Say 'continue the goal' to resume.") : "No active goal. Say 'set a goal: <label>'." });
      }
      return Promise.resolve({ ok: true, message: "Tell me the goal and I'll track it, e.g. 'set a goal: organize downloads'. Then say 'continue the goal' to resume the plan." });
    } });
})(window);

/* -- File-level self-healing commands (v2.16.1) -- */
(function () {
  "use strict";
  var C = global.LH_AI.Commands;
  var SH = global.LH_AI.SelfHeal;
  var FE = SH && SH.FileEngine;
  if (!C) return;

  // show incident <id>
  C.register({ module:"selfheal", category:"selfheal", name:"show-incident", deep:true,
    match:[/\bshow (incident|bug) ([\w-]+)\b/i,/\bincident ([\w-]+)\b/i],
    admin:true, run:function(t){ return SH.listIncidents().then(function(l){ var m=t.match(/([\w-]+)/g); var id=m&&m[1]; var inc=l.find(function(i){return i.incidentId===id||i.component===id;}); if(!inc)return {ok:true,message:"Incident not found."}; return {ok:true,message:"Incident "+inc.incidentId+" ["+inc.state+"]\ncomponent: "+inc.component+"\nerror: "+String(inc.error).slice(0,120)+"\nseverity: "+inc.severity+"\nRCA: "+((inc.rootCause&&inc.rootCause.causes)||[]).join(" | ")};}); }});

  // show patch <id> / show diff
  C.register({ module:"selfheal", category:"selfheal", name:"show-patch", deep:true,
    match:[/\bshow (patch|diff) ([\w-]+)\b/i,/\bpatch ([\w-]+)\b/i],
    admin:true, run:function(t){ return SH.listIncidents().then(function(l){ var m=t.match(/([\w-]+)/g); var id=m&&m[1]; var inc=l.find(function(i){return (i.candidateFix&&i.candidateFix.patchId)===id||(i.incidentId)===id;}); var p=inc&&inc.candidateFix; if(!p)return {ok:true,message:"No patch found."}; return {ok:true,message:"Patch "+p.patchId+" ["+p.status+"]\nfiles: "+(p.files||[]).join(", ")+"\nreason: "+p.reason+"\n"+(p.diff||"(no diff)")};}); }});

  // show snapshot <id>
  C.register({ module:"selfheal", category:"selfheal", name:"show-snapshot", deep:true,
    match:[/\bshow (snapshot|backup) ([\w-]+)\b/i],
    admin:true, run:function(t){ var m=t.match(/([\w-]+)/g); var id=m&&m[1]; return SH.listBackups().then(function(b){ var s=b.find(function(x){return x.snapshotId===id||x.backupId===id;}); if(!s)return {ok:true,message:"No snapshot found."}; return {ok:true,message:"Snapshot "+(s.snapshotId||s.backupId)+" @"+(s.timestamp||"")+"\nfiles: "+((s.files||[]).map(function(f){return f.path;})).join(", ")};}); }});

  // test patch <id>
  C.register({ module:"selfheal", category:"selfheal", name:"test-patch", deep:true,
    match:[/\btest (patch|fix) ([\w-]+)\b/i],
    admin:true, run:function(t){
      return SH.listIncidents().then(function(l){
        var m=t.match(/([\w-]+)/g); var id=m&&m[1];
        var inc=l.find(function(i){ return (i.candidateFix&&i.candidateFix.patchId)===id; });
        var p=inc&&inc.candidateFix;
        if(!p){ return {ok:true, message:"No patch to test."}; }
        return FE.testFilePatch(p).then(function(r){
          var cs = "";
          for (var i=0;i<r.checks.length;i++){ cs += r.checks[i].name + " = " + r.checks[i].ok + "; "; }
          return {ok:true, message:"Test [" + r.level + "] passed=" + r.passed + "\nchecks: " + cs + "\nlimitations: " + r.limitations.join("; ")};
        });
      });
    } });

// verify fix <id>
  C.register({ module:"selfheal", category:"selfheal", name:"verify-fix", deep:true,
    match:[/\bverify (fix|patch) ([\w-]+)\b/i],
    admin:true, run:function(t){
      return SH.listIncidents().then(function(l){
        var m=t.match(/([\w-]+)/g); var id=m&&m[1];
        var inc=l.find(function(i){ return (i.candidateFix&&i.candidateFix.patchId)===id; });
        var p=inc&&inc.candidateFix;
        if(!p||!FE){ return {ok:true, message:"No patch to verify."}; }
        return FE.verifyFilePatch(p).then(function(v){
          return {ok:true, message: v.ok ? ("Verified " + p.files[0]) : ("Verification failed: " + v.code)};
        });
      });
    } });

// engine health / self-diagnosis
  C.register({ module:"selfheal", category:"selfheal", name:"engine-health", deep:true,
    match:[/\b(self[- ]?heal(?:ing)? engine|engine) (health|diagnos|status|check)\b/i,/\bself[- ]?diagnos(is|e) (the )?engine\b/i],
    admin:true, run:function(){ if(!FE)return {ok:true,message:"File engine not loaded."}; var h=FE.engineSelfDiagnose(); return {ok:true,message:"🧠 Self-Heal Engine Health\nhealthy="+h.healthy+"\n"+h.findings.map(function(f){return "• "+f.check+": "+f.note;}).join("\n")+(h.recommended.length?"\nRecommended: "+h.recommended.join("; "):"")}; }});

// ================= v2.17 command surface =================
// reproduce incident <id>
C.register({module:"selfheal",category:"selfheal",name:"reproduce",deep:true,
  match:[/\breproduce (incident|bug|issue) ([\w-]+)\b/i,/\btry to reproduce\b/i],
  admin:true, run:function(t){
    return SH.listIncidents().then(function(l){
      var m=t.match(/([\w-]+)/g); var id=m&&m[1];
      var inc=l.find(function(i){return i.incidentId===id;}) || l[l.length-1];
      if(!inc) return {ok:true,message:"No incident to reproduce."};
      return SH.reproduceIncident(inc).then(function(r){
        return {ok:true,message:"Reproduction ["+r.method+"] status="+r.status+"\nreproduced="+r.reproduced+"\nsteps: "+(r.steps||[]).join("; ")+(r.note?"\nnote: "+r.note:"")};
      });
    });
  }});

// run build (Android)
C.register({module:"selfheal",category:"selfheal",name:"run-build",deep:true,
  match:[/\b(run|do) (the )?build\b/i,/\bbuild (localhub|the app|the project)\b/i,/\bassemble (debug|apk)\b/i],
  admin:true, run:function(){
    return SH.buildLocalHub().then(function(r){
      var steps=r.steps.map(function(s){return "• "+s.step+": "+(s.status||s.changed);}).join("\n");
      return {ok:true,message:"🏗 Build status: "+(r.status||"")+"\n"+steps+"\n"+((r.message)||"")};
    });
  }});

// verify device
C.register({module:"selfheal",category:"selfheal",name:"verify-device",deep:true,
  match:[/\bverify (the )?device\b/i,/\bdevice verification\b/i,/\bcheck (on )?(real )?device\b/i],
  admin:true, run:function(){
    return SH.verifyDevice().then(function(r){
      var rows=r.checks.map(function(c){return "• "+c.check+": "+c.status;}).join("\n");
      return {ok:true,message:"📱 Device verification: "+r.status+"\n"+rows};
    });
  }});

// run regressions
C.register({module:"selfheal",category:"selfheal",name:"run-regressions",deep:true,
  match:[/\brun (the )?regress(ion)? (tests|suite|checks)?\b/i,/\bregression (tests|suite|checks)\b/i,/\btest regressions\b/i],
  admin:true, run:function(){
    return SH.runRegressions().then(function(r){
      var rows=(r.results||[]).map(function(x){return "• "+x.name+" ["+(x.component||"")+"]: "+(x.status||(x.ok?"PASSED":"FAILED"));}).join("\n");
      return {ok:true,message:"🧪 Regression suite: ran="+r.ran+" passed="+r.passed+" failed="+r.failed+"\n"+rows};
    });
  }});

// model status
C.register({module:"selfheal",category:"selfheal",name:"model-status",deep:true,
  match:[/\bmodel (status|provider|back(end)?)\b/i,/\b(local )?ai model\b/i,/\bwhat model (are you|do you use)\b/i],
  admin:false, run:function(){
    var s=SH.modelStatus();
    return {ok:true,message:"🧠 Local Model: kind="+s.kind+" available="+s.available+"\nfallback: "+(s.deterministicFallback?"deterministic (no LLM)":"local model")+"\n"+s.note};
  }});

// set model provider (attach a compatible local model adapter)
C.register({module:"selfheal",category:"selfheal",name:"set-model",deep:true,
  match:[/\b(set|attach|use) (a )?(local )?(model|llm|provider)\b/i,/\bconnect (a )?local model\b/i],
  admin:true, run:function(){
    return {ok:true,message:"To attach a compatible local model (Ollama/llama.cpp/ONNX/remote), call SelfHeal.setLocalModelProvider(provider) from the dashboard console with a provider implementing analyzeIncident/proposePatch/explainRCA/generateTests/plan. Until then the deterministic fallback is used and reported honestly. (No hard-coded vendor; no cloud dependency.)"};
  }});

// report a failure (manual detection feed)
C.register({module:"selfheal",category:"selfheal",name:"report-failure",deep:true,
  match:[/\b(report|log) (a )?(failure|crash|error|exception)\b/i,/\b(failed|crash) (api|websocket|automation|database|server)\b/i],
  admin:true, run:function(t){
    var kind="exception";
    if(/websocket|socket/i.test(t))kind="websocket_failure";
    else if(/automation/i.test(t))kind="automation_failure";
    else if(/database|db/i.test(t))kind="database_error";
    else if(/server/i.test(t))kind="server_failure";
    else if(/api/i.test(t))kind="api_failure";
    else if(/crash|crash/i.test(t))kind="crash";
    return SH.ingestDetection(kind, String(t||"").slice(0,160), {component:kind}).then(function(r){
      return {ok:true,message:"Detection fed: kind="+kind+" action="+r.action+(r.incident?(" incident="+r.incident.incidentId):"")};
    });
  }});

// ================= v2.19 deep-debugging commands =================
C.register({module:"selfheal",category:"selfheal",name:"debug-incident",deep:true,
  match:[/\b(debug|investigate) (incident|bug|issue) ([\w-]+)\b/i,/\bdebug (this|it|the (crash|bug))\b/i,/\brun (a )?(deep )?(debug|investigation)\b/i],
  admin:true, run:function(t){
    var D=SH.Debug; if(!D)return {ok:true,message:"Debug engine not loaded."};
    return SH.listIncidents().then(function(l){
      var m=t.match(/([\w-]+)/g); var id=m&&m[1];
      var inc=l.find(function(i){return i.incidentId===id;}) || l[l.length-1];
      if(!inc)return {ok:true,message:"No incident to debug."};
      return D.runDebugSession({error:inc.error, component:inc.component, incidentId:inc.incidentId, stackTrace:inc.stackTrace||""},{maxInvestigationAttempts:4}).then(function(r){
        var s=r.session;
        var out=["🔍 Debug session "+s.sessionId, "status: "+r.status, "root cause: "+(s.selectedRootCause?(s.selectedRootCause.id+" - "+s.selectedRootCause.description):"none"), "rca confidence: "+((s.confidences&&s.confidences.rca)||0), "selected patch: "+(s.selectedPatch?s.selectedPatch.id:"none"), "hypotheses: "+s.hypotheses.map(function(h){return h.id+"("+Math.round((h.confidence||0)*100)+"%)"+(h.rejected?"✗":"");}).join(", ")];
        return {ok:true,message:out.join("\n")};
      });
    });
  }});

C.register({module:"selfheal",category:"selfheal",name:"hypotheses",deep:true,
  match:[/\bhypoth(eses|esis)\b/i,/\b(what are|show) (the )?possible (causes|root causes)\b/i],
  admin:true, run:function(t){
    var D=SH.Debug; if(!D)return {ok:true,message:"Debug engine not loaded."};
    return SH.listIncidents().then(function(l){
      var inc=l[l.length-1]; if(!inc)return {ok:true,message:"No incident to hypothesize about."};
      var hs=D.rankHypotheses(D.buildHypotheses({error:inc.error,component:inc.component,stackTrace:inc.stackTrace||""}));
      return {ok:true,message:"🧠 Hypotheses for "+inc.incidentId+":\n"+hs.map(function(h){return "• "+h.id+" (conf "+Math.round((h.confidence||0)*100)+"%, score "+(h.score||0)+")\n   "+h.description+"\n   test: "+h.testMethod;}).join("\n")};
    });
  }});

C.register({module:"selfheal",category:"selfheal",name:"known-pattern",deep:true,
  match:[/\b(known|similar|recurring|repeated) (pattern|incident|bug)\b/i,/\bhave (i|we) (seen|fixed) (this|it) before\b/i],
  admin:true, run:function(t){
    var D=SH.Debug; if(!D)return {ok:true,message:"Debug engine not loaded."};
    return SH.listIncidents().then(function(l){
      var inc=l[l.length-1]; if(!inc)return {ok:true,message:"No incident to match."};
      return D.matchKnownPattern({error:inc.error,component:inc.component,incidentId:inc.incidentId}).then(function(r){
        return {ok:true,message:"🔁 Pattern: "+r.pattern+" (similarity "+(r.similarity||0).toFixed(2)+")\n"+r.message};
      });
    });
  }});
})();
