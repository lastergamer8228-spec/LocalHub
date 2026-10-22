# Self-Healing Engine — Test Results (v2.17)

> Status: **67 / 67 PASS** · Generated 2026-08-10 · headless, deterministic,
> against the actual `selfheal.js` engine with a mock FS/Memory.

## Coverage (all real assertions)

| Area | Tests | Result |
|------|-------|--------|
| 1. Normal incident → RCA → gated proposal | 4 | ✅ |
| 2. Insignificant incident ignored (threshold) | 2 | ✅ |
| 3. Critical-file protection | 2 | ✅ |
| 4. Approval gate (L4) | 1 | ✅ |
| 5. Patch proposal | 1 | ✅ |
| 6. Hash-mismatch abort | 1 | ✅ |
| 7. Path-traversal rejection | 2 | ✅ |
| 8. Outside-workspace rejection | 3 | ✅ |
| 9. Real backup (content + hash + persisted) | 2 | ✅ |
| 10. Patch apply + after-hash | 3 | ✅ |
| 11. Full `runFileFix` → VERIFIED | 2 | ✅ |
| 12. Static test failure | 2 | ✅ |
| 13. Auto-rollback on verify failure | 4 | ✅ |
| 14. Rollback verifies hash | 2 | ✅ |
| 15. Rollback failure honest | 2 | ✅ |
| 16. Regression memory + runner | 4 | ✅ |
| 17. Incident-memory safe reuse (critical gate) | 4 | ✅ |
| 18. Persistent goal | 2 | ✅ |
| 19. Engine self-diagnosis | 2 | ✅ |
| 20. Security rejection via runFileFix | 1 | ✅ |
| 21. Unified detection feed + thresholds | 3 | ✅ |
| 22. Build allowlist runner (honest BUILD_REQUIRED) | 4 | ✅ |
| 23. Device verifier (honest) | 3 | ✅ |
| 24. LocalModelProvider adapter + fallback | 3 | ✅ |
| 25. RCA explanation | 1 | ✅ |
| 26. Reproduction (REPRODUCED / NOT_REPRODUCIBLE) | 2 | ✅ |
| 27. Self-healing self-test (controlled failure → full repair) | 6 | ✅ |

## Key honest-status behaviors verified
- `BUILD_REQUIRED` returned (not fake success) when no Android toolchain.
- `DEVICE_VERIFICATION_REQUIRED` for all 12 device checks (never green).
- `NOT_ALLOWED` for non-allowlisted build commands.
- `ROLLBACK_FAILED` / hash-mismatch never claimed as recovered.
- Controlled syntax-error failure was detected → reproduced → patched → verified →
  repaired code parses.
