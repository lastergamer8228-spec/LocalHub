# LocalHub Self-Healing Security

> Status labels: ✅ IMPLEMENTED · 🟡 PARTIAL · ⭕ OPTIONAL · ❌ NOT IMPLEMENTED

The self-healing engine is a **user of LocalHub's security model**, never a bypass.

## Hard rules (enforced)

- **Never** bypass authentication, authorization, permissions, security policies,
  user privacy, or data protection.
- **Never** delete user data as a "repair".
- **Never** modify credentials automatically.
- **Never** disable security controls to make a test pass.
- **Never** hide errors or fabricate successful repairs.
- **Never** silently replace large parts of the application.

## Enforced gates

| Gate | Behavior | Status |
|------|----------|--------|
| Permission | Admin tools require admin role (`Cognitive.decide`) | ✅ |
| Risk confirmation | high/critical risk → confirm | ✅ |
| Critical component | auth/security/migration/storage → admin approval | ✅ |
| Significance | frequency × severity threshold before acting | ✅ |
| Test-before-deploy | patch must pass checks before deploy | 🟡 |
| Rollback | restore last known good if verify fails | ✅ |
| Learning bound | only memory/knowledge/procedures updated, never executable security code | ✅ |

## Autonomy principle

- **Autonomous when safe** (observe, safe recovery, low-risk tested patches).
- **Supervised when risky** (critical, uncertain, high-impact, data-loss,
  security, incomplete tests, no rollback).

---

© LocalHub — the assistant is a capability user, not a security bypass.

---

## File-Level Security (v2.16.1) — ✅ IMPLEMENTED

- **Workspace allowlist**: only LocalHub app dirs are patchable; everything else →
  `OUTSIDE_WORKSPACE`.
- **Path traversal blocked**: `..` anywhere in a target path → `PATH_TRAVERSAL`.
- **No arbitrary command execution**: build commands use an allowlist only; the
  engine never runs model-generated shell.
- **No model-generated code execution**: patches are applied as file content, not
  executed.
- **Critical files** (auth/security/keystore/credentials/secrets) → always
  `AWAITING_APPROVAL` unless explicitly approved by admin.
- **Before-hash check** prevents patching a file that changed since proposal.
- **Rollback verifies hashes**; on failure → `ROLLBACK_FAILED` + adminRequired,
  never a fake "recovered".
- If a proposed fix would violate a rule, it is rejected
  (`PATCH_REJECTED_SECURITY_POLICY` style gate) rather than applied.

## Patch rejection codes (security)
`PATH_TRAVERSAL`, `OUTSIDE_WORKSPACE`, `CRITICAL_FILE`, `HASH_MISMATCH`,
`READ_FAILED`, `WRITE_FAILED`, `PATCH_REJECTED_SECURITY_POLICY`.

---

## v2.17 — Security additions

- **Build allowlist** — the engine only ever executes `./gradlew
  test/assembleDebug/lint/compileDebugKotlin`. Any other command → `NOT_ALLOWED`.
  Model output is never turned into shell; patches are file content, not code.
- **Detection feed** is read-only: it records failures, emits Cognitive events and
  opens incidents — it does not modify files or configs on its own.
- **Incident-memory reuse is safety-gated**: `validateReuse` rejects signature
  mismatch and **refuses auto-reuse on critical components** (requires admin).
- **Reproduction never touches production**: `reproduceIncident` only reports a
  status; it does not modify the running app.
- **Device verification** never fabricates: all 12 checks report
  `DEVICE_VERIFICATION_REQUIRED` until a real device confirms them.

---

## v2.19.1 — Hardening security additions

- **Canonical path enforcement**: `..`, absolute-outside, symlink/junction/mount
  escapes are rejected before read/write/backup/patch/delete/restore.
- **Protected files** are L5/admin-only (rollback engine, transaction journal,
  SelfHeal gates, update/deploy, credentials, core storage, migration, security).
  Never silently modified.
- **Scope + attempt limits** stop a runaway repair and require admin.
- **Cooldown / repair-storm prevention** stops auto-repair after repeated failures.
- **Corruption fail-safe**: unexpected hash / missing backup / partial patch etc.
  → stop, no speculative patch.
- **Unsafe model output** is rejected; the deterministic engine stays the
  authority for permissions, risk, workspace, backup, deploy, rollback, verify.
- **Audit trail** records who/what/reason/risk/files/patch/tests/approval/backup/
  deployment/verification/rollback/outcome — never silently modified.
