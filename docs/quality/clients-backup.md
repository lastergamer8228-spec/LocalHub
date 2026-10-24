# Step 2 — Client management + backup/export — 1.0.16 (code 17)

Sequence agreed by the user: integrate everything first, run device testing at the
end. This is step 2 of 4.

## 1. Clients screen now manages devices

Before: the screen only listed recent connections; every policy action lived in
the web API, so the native app looked like it had “dead” screens.

Now, per client card:
- **Block / Unblock** a device.
- **File access**: normal / read-only (`RO`) / denied (`deny`).

Rules:
- **Restrictive** changes (block, read-only, deny) always open a confirmation
  dialog, because they cut off or limit a device.
- **Restoring** access (unblock, back to normal) applies immediately — no extra
  dialog for the safe direction.
- Actions are applied through the **same `ClientTracker`** the HTTP API uses
  (native UI and server share the process), so there is no second, divergent
  policy implementation. `ClientTracker` now exposes `blockedFlow` and
  `restrictionsFlow` so the list stays live after a change.
- Feedback is shown in the screen and states exactly what changed.

## 2. Settings backup & log export

New **Backup & export** section in Settings:

- **Export settings** → JSON via SAF (you choose where to save).
- **Export logs** → JSON of stored log entries.
- **Import settings** → JSON via SAF, restoring only validated preferences.

Security rule enforced by `BackupSerializer` and covered by tests:
- Only non-secret preferences are exported/restored: `port`, `theme`,
  `autostart`, `serverName`.
- **Passwords and TOTP/2FA secrets are never exported and never restored.**
  Unknown or credential-like keys found in a file are ignored **and reported** to
  the user, so a tampered or older backup cannot inject secrets.
- Values are validated on import (port 1024–65535, theme in
  dark/light/system, autostart boolean, server name 1–64 chars).
- Wrong backup kind and malformed files produce a clear error instead of partial
  application.
- Log export is **bounded to the newest 2 000 entries**, flagged as truncated
  when more exist, so the file cannot grow without limit.

## Tests (89 passing JVM tests, +10 this step)

- `BackupSerializerTest` (8): settings round-trip, credentials never exported,
  credential-like keys in a file ignored and reported, invalid values rejected,
  empty/malformed input errors, wrong backup kind refused, log export bounded and
  truncation flag correct.
- `ControllerScreensTest` (+2): blocking asks first (cancel does nothing, confirm
  blocks), and a blocked device shows Unblock which restores access without a
  dialog.

All previous suites still pass (threading/ANR policy, TLS, upload streaming,
crash recovery, module policy, navigation, host catalog).

## Not verified here

The SAF file picker and real file writes are **not** unit-tested (they need an
Activity); the serializer around them is. Device confirmation is pending by
agreement until all steps are integrated.

## Phone acceptance (deferred to the end)

1. Clients: block a device → it can no longer load the dashboard; unblock → works
   again; set read-only → uploads/deletes refuse, browsing works.
2. Export settings to a file, change a setting, import the file → only the
   allowed preferences return; confirm no password/2FA is applied.
3. Export logs and open the JSON; confirm entries and the truncation flag.
4. Import a tampered file containing `adminPass` → it is ignored with a clear
   message, and the current credentials remain unchanged.

## Remaining sequence

- **Step 3:** performance & assistant quality — folder listing limits/pagination,
  prune low-value assistant answers, faster `/ai` load.
- **Step 4:** release readiness — R8/Proguard rules, lint/CI, and an honest Play
  assessment (`MANAGE_EXTERNAL_STORAGE` is restricted by Play policy; Play
  publishing would need scoped storage/SAF, while sideload/personal use is
  unaffected).
- **Then:** full device testing of the integrated build.
