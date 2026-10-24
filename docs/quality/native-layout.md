# Native controller layout/navigation fixes — 1.0.10 – 1.0.12 (codes 11–13)

This pass targets the Android controller, not the webpage. It is not acceptance
of the whole app as finished or launch-ready.

## Dead Home tab (1.0.11, code 12)

Symptom: after opening Modules/Settings, tapping the bottom Home tab did nothing;
the previous screen stayed. Temporary instrumentation during diagnosis recorded:

```text
click=dashboard selected=dashboard current=modules   -> blocked=dashboard
```

The click handler compared a **stale captured** `selected` value against the
requested route, while the live back stack was already `modules`. The guard
therefore treated the Home click as "already here" and skipped navigation.
Identical navigation options worked in isolation, confirming the guard — not
`NavOptions` — was at fault.

Fix: `selectScreen` now reads `navController.currentBackStackEntry` **at click
time** instead of a captured composition value. Re-clicking the current tab is
still a no-op (Modules re-click only resets list position), so no duplicate
back-stack entries or animation/state regressions were introduced.

Permanent regression coverage: `HomeNavigationTest` verifies Modules/Activity/
Clients/Settings → Home actually returns to Home content, repeated Home clicks
stay stable, and the Home "Server settings" callback reaches Settings and back.

## Clients / Logs / Home clean-up (1.0.12, code 13)

Sweep of the remaining native screens found four concrete defects:

1. **Logs “Clear” deleted every stored entry with no confirmation** — a single
   mis-tap destroyed history. It now opens a confirm dialog stating the entry
   count and that deletion cannot be undone; it is disabled when there are no
   logs, and confirming performs exactly one destructive call.
2. **ClientCard could overflow the card**: the text column had no `weight`, so a
   long IP / user agent pushed text past the card edge, especially at large font
   scale. Fixed with `weight(1f)` plus bounded lines/ellipsis; covered by a
   2×-font layout test.
3. **Lazy lists had no stable keys** (Clients, Logs, Home activity), so item
   state could jump when the list changed. Keys added; Home also gained an empty
   state that points to the Activity tab for stored history.
4. **Misleading “Connected Clients” wording**: the tracker keeps WebSocket
   clients while connected and HTTP clients for a short window after a request,
   so the screen now says “recent connection(s)” and explains the HTTP window.
   `LogItem` also shows the entry `tag` (previously hidden), which is what makes
   an entry traceable, using a two-line layout that stays readable at 2× font.
   The Home CPU bar is hidden when telemetry is unavailable instead of rendering
   a misleading zero-length bar.

Screens were split into stateless content (`LogsContent`, `ClientsContent`) plus
a thin ViewModel wrapper, so these behaviours are testable without Room/servers.
6 new Robolectric/Compose tests cover clear-confirmation (cancel and confirm),
disabled clear, tag/count rendering, overflow bounds at 2× font and empty states.
A grep sweep confirmed no empty `onClick = {}` handlers remain in the native UI.

## Reported regression and reproduced cause

The Modules header placed a long description and a long enabled-count sentence
in one unweighted Compose Row. The first Text could consume the available width;
the counter was measured in the remaining narrow/zero width and wrapped into a
very tall column. Because that header was a LazyColumn item, the first module
was below the viewport before any meaningful feature control appeared.

A Compose/Robolectric regression fixture reproduces that Row pushing the first
feature out of view, then verifies the replacement makes the first switch visible.
This is stronger than source inspection, but is still not the user's physical phone.

## Structural changes

- Shared native title/navigation frame: Home, Modules, Activity, Clients, Settings.
  NavHost explicitly fills its bounded content area; scaffold insets are applied
  and consumed once. Navigation labels/title have bounded wrapping.
- Modules uses a short, width-constrained summary above a weight-bounded list.
  Short viewports use a compact count instead of reserving most of the screen
  for help text. No negative padding or font-scale suppression workaround.
- Only actual feature switches count toward the summary. File Manager/Media/AI
  and other controllable features precede informational components.
- Required/info-only components are collapsed under a separate section, without
  decorative switches. Existing module enforcement/persistence is unchanged.
- Cards have bounded title/description previews and clear On/Off/Required/Info
  labels. Full description, version/ID, requirements and limits are in Details;
  details touch area is at least 48dp and its expansion state is saveable.
- Entering/reselecting Modules requests list position zero. Normal toggle/data
  updates do not reset position. Saved position survives unchanged-entry state
  restoration; a new explicit open request resets it.
- Theme changes recompose the existing navigation tree instead of crossfading
  whole copies of NavHost. Current route/list position is covered by a UI test.
- Home status/actions are stacked rather than squeezed into an icon/text/actions
  row. A real Server settings navigation callback is provided by NavHost, also
  when the server is stopped. No duplicate Start/Stop/Restart controls were added.
- Settings keeps Start/Stop/Restart together. Copy URL/Open browser/QR are grouped
  in Connection with name/port; maintenance is separate. Debug-style explanatory
  text was trimmed, unsupported-feature notes remain honestly in About.

The preview launcher label is now **LocalHub Preview** to distinguish it from
the original LocalHub app. Package/signing identity remains the same preview,
so this is an update, not a second new preview installation.

## Native test evidence

The final suite has **43** passing JVM tests, broken down as:
- 24 Compose/Robolectric UI tests (API 34, native graphics, test Application).
- 3 pure presentation-order/count tests.
- 16 retained module-policy, session-validation and host-descriptor tests.

The UI tests use actual production ControllerScaffold, ModulesContent, ModuleCard,
ServerStatusCard and theme components. Module metadata comes from the production
module registry; callbacks/data updates are controlled fixtures. AppContainer,
Room, foreground service, live HTTP and phone permissions are not started by the
UI tests. Robolectric is not a physical-device/emulator acceptance run.

Coverage includes:
- 360dp/320dp width and normal/1.5×/2× font scaling.
- Short landscape qualifiers 640×360dp with 2× font scale.
- First feature switch above bottom navigation; bounded header height.
- Loading→data arrival without scrolling to discover the first feature.
- Toggle data update retaining scroll, tab reselection returning to top.
- Save/restore retaining old position until a new entry request.
- Required components collapsed and without fake switches.
- Legacy Row reproduction vs corrected layout.
- Real navigation state/list retention across theme changes in a NavHost fixture.
- Home action visibility/callbacks for stopped/running state, including double font.

Command: `./gradlew testDebugUnitTest -PaacPreview=true`.
First run needs Robolectric/Android test artifacts from Maven Central. Test-only
Robolectric dependencies are not bundled as production app logic; the Compose
UI-test manifest is a debug-only dependency.

APK build/signature and preview-update compatibility are verified at delivery.
All webpage assets are compared byte-for-byte against the previous APK, because
no web/assistant/audio/repair changes were intended in this layout pass.

## Phone acceptance / unfinished work

Update the preview without uninstalling, then open Modules without scrolling.
Check default and your existing text size, portrait/landscape, returning from
Settings, reselecting Modules, toggle updates and light/dark theme changes.
Send an opening-screen screenshot if the first feature is still not visible;
include app version, phone orientation and text/display scaling settings.

Do not use this pass to claim full native UI completion. Clients/Activity density,
keyboard/IME and other Settings states, TalkBack, OEM/system-bar differences and
end-to-end navigation→ViewModel→Room→server device tests still need acceptance.
Known security/lifecycle/repair-engine release blockers remain in the controller
and assistant audit guides. No data schema or backend feature contract changed.
