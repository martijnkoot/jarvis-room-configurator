# Integrated floorplan validation — 2026-11-06

Base: `d3332c6` (merged PR #4). No merge, release or installation performed.

- JavaScript syntax check and 27 Node tests pass, including source isolation,
  five slots from both observed office/kitchen naming stems, renamed registry
  entities, disabled/ambiguous/missing entries, registry access failure, legacy
  conversion, transform mirrors/scale, independent two-sensor interpolation,
  bounded history, disappearance, fading and reused IDs.
- 11 Python distribution and regression checks pass.
- Real isolated Chrome at 390 and 1280 px: existing radar fixture 14 assertions
  per width; integrated fixture 31 assertions per width, plus real pointer
  translation and rotation. Covers Lovelace config event/echo and recreation,
  unknown option preservation, invalid drafts, mixed units, live targets without
  calibration gates, automatic source selection, asynchronous shared registries,
  renamed polygon resolution, explicit Apply scoped to one simulated text entity,
  runtime dialog, viewport fit and animation cancellation on disconnect.
- The polygon action in the fixture uses a service recorder; no real HA write.
- Read-only inspection in the existing HA browser confirmed kitchen entity IDs,
  five targets, metre units, presence and polygon naming. They were unavailable.
  This does not validate kitchen runtime tracking or physical coordinate accuracy.
- The new module was not loaded into HA. Real Lovelace save/reload, device registry
  permissions on a non-admin account, physical placement and polygon persistence
  remain installation acceptance checks. Arbitrary house geometry, multiple-floor
  UI, ceiling/tilt projection and sensor fusion remain unsupported.

Commands:

```sh
node --check dist/jarvis-room-configurator.js
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -v
CHROME_BIN=/path/to/chrome node tests/browser-check.cjs
```

CI repeats these checks and Marketplace/HACS plugin validation on the feature
branch and pull request. Inspect those statuses for the exact pushed commit.
