# Jarvis Room Configurator v0.7.0

![Jarvis Room Configurator logo](docs/icon.png)

An optional Home Assistant Marketplace / HACS **Dashboard plugin** for existing
ESPHome LD2460 roomnodes. No Python integration, configuration flow or Helper is
required. This migration retains the existing target card and its configuration.

## Installation

Add `https://github.com/martijnkoot/jarvis-room-configurator` as a custom
repository in Marketplace / HACS with type **Dashboard** (backend category
`plugin`), then download it. This is not a claim of inclusion in the default catalog.
Use a version containing the v0.7.0 layout; old v0.6.x releases are integrations.
A feature branch / PR is not a published Marketplace upgrade.

Check the dashboard resources after installation. There must be exactly one
JavaScript module for this card. HACS normally registers the resource; if it does
not, add `/hacsfiles/jarvis-room-configurator/jarvis-room-configurator.js` manually.
The underlying file is installed in `www/community/jarvis-room-configurator/`.
For manual installation, copy `dist/jarvis-room-configurator.js` to that directory
and add `/local/community/jarvis-room-configurator/jarvis-room-configurator.js`
as a JavaScript module. Reload the browser after changing resources.

```yaml
type: custom:jarvis-target-card
title: Kantoor — LD2460
entity_prefix: sensor.kantoor_
range: 6
flip_x: true
flip_y: true
smoothing_ms: 180
trail_seconds: 8
```

Choose a prefix matching **one** roomnode. Target entities must end in
`tracking_target_N_x` / `_y` or `target_N_x` / `_y` (N = 1–5), with units
`m`, `cm` or `mm`. Missing/unsupported units and unavailable targets are not plotted.
`range` is the display scale in metres, not a device setting. Flips affect only
the display. Smoothing (0–2000 ms) and trails (0–60 seconds) are visual only;
tracking IDs and trails do not establish a person's identity.

## Zones and editing

The card displays four detection zones and two exclusions simultaneously, plus
firmware-reported counts. It reads existing `text.<prefix>*polygon_zone_1..4`
and `text.<prefix>*polygon_exclusion_1..2` entities. Counts use
`sensor.<prefix>*polygon_zone_N_target_count` or `*zone_N_target_count`.
Missing or ambiguous matches are not guessed.

Select a zone, choose **Draw new**, add 3–20 vertices and **Finish**; drag vertices
to refine it. **Clear** previews deletion and **Reload** discards the draft.
Only **Apply to ESPHome** calls Home Assistant `text.set_value` for the selected
entity, using firmware format `Xmm:Ymm;Xmm:Ymm`. An empty polygon clears it.
The roomnode's existing polygon firmware package must already be installed.
ESPHome text states are optimistic: a successful service call does not prove
persistent storage. Check the entity state and verify persistence by restarting
the roomnode when appropriate. Drafts and trails are not persisted by the card.

## Migrating from v0.6.x

1. Back up Home Assistant and record the existing card YAML, resources and zone
   text values. Keep the old integration version available for rollback.
2. Plan a maintenance window. Remove the old integration/config entry through
   supported Home Assistant controls while its Python code is still available,
   then remove its Marketplace installation. Restart Home Assistant as required.
3. Add/download the repository as **Dashboard**, using a version with the new
   distribution layout. Replace the old `/jarvis_room_configurator/target-card.js`
   resource (including version queries) with the new module URL above. Do not
   load both resources. Keep the card YAML unchanged and reload the browser.
4. Verify live targets, both flips, smoothing, trails, all polygons and counts.
   If a write test is desired, explicitly apply a recorded zone and verify its
   state and persistence. Installation itself must not write device settings.

**Known leftover Helper:** an old entry registered as a Helper may show
`Invalid handler specified` and may not be removable through its normal UI.
The Dashboard plugin cannot repair or delete that backend entry. If supported
removal fails, stop that cleanup and handle it separately before removing the
old Python files; retain a backup and the old version for recovery. Do not edit
`.storage` or assume uninstalling the repository removes its config entry.
No live Home Assistant cleanup is performed by this repository migration.

To roll back, remove the new module resource, restore the previous integration
version and its resource, restart Home Assistant and reload the dashboard.
Avoid loading both versions of `jarvis-target-card` together.

## Independence and limitations

ESPHome owns radar settings, stored polygons and occupancy; the card uses
`hass.states` and the standard `text.set_value` service. It has no private
backend API, imports or runtime asset dependencies. The removed Python layer
only served the old JavaScript URL. Removing this plugin does not send any
commands or erase device polygons. Remove its dashboard cards and resource too.
See [ADR-001](docs/ADR-001-independence.md).

The existing radar view assumes side/wall mounting with forward-positive Y.
Ceiling projection remains unsupported. A separate ground-floor prototype is
now available; see the floorplan section below. Automated tests
cover standalone loading and core behavior with simulated Home Assistant states;
they do not establish real browser rendering, HACS installation or firmware
persistence. Verify these in a test installation before production migration.

## Development and validation

No frontend build or dependencies are required; `dist/jarvis-room-configurator.js`
is the maintained source and distributable. Run from the repository root:

```sh
node --check dist/jarvis-room-configurator.js
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -v
```

CI also runs `hacs/action` with `category: plugin`. Hassfest is not applicable to
this JavaScript distribution. Python is only used for repository tests.
No release is created automatically by these workflows. For a future v0.7.0
release, tag the reviewed commit with this layout; if publishing a release
asset, use the exact filename `jarvis-room-configurator.js` from `dist/`.

## License

See [LICENSE](LICENSE). No SmartHomeShop source is included.

## Radar field of view (feature; no new release)

The cyan fan is a **schematic display sector**, separate from detection and
exclusion polygons. It defaults to 6 m and 120° (±60°), based on
[Hi-Link's LD2460 specifications](https://www.hlktech.com/en/Goods-345.html).
A circular sector is an approximation, not a measured coverage boundary: motion,
stationary presence, edge angles, mounting, enclosure and obstructions affect
actual detection. It must not be used as evidence that a person will be detected.

```yaml
show_fov: true       # false hides the fan and its legend
fov_range: 6         # metres, >0..6; schematic display only
fov_angle: 120       # legacy symmetric fallback; explicit boundaries take precedence
```

The origin is the radar's local `(0, 0)` position, forward is +Y, and positive
bearing points toward +X. The default fan is centred on +Y with metre arcs and a direction
arrow; explicit left/right boundaries can make it asymmetric. Both flips apply to every point, including arcs and the arrow. There is
no separate world-position or rotation setting: this is a single-radar local
view. Adding an independent rotation would misalign the raw target coordinates.
`range` still changes display scale only. The wide viewport fits the default six-metre fan without cropping. Explicit smaller
scales can still crop it; there is no automatic rescaling.

A dashed grey sector additionally shows **configured radar limits**, when all
three unique `number.<prefix>*tracking_radar_detection_distance`,
`*tracking_radar_detection_start_angle` and `*tracking_radar_detection_end_angle`
entities exist with valid units (`m`/`cm`/`mm`, and `°`). Limits must fit side-mode
bounds: >0..6 m and -60° ≤ start < end ≤ 60°. Missing, unavailable, ambiguous or
invalid values omit only this grey sector; they never change the display sector.
It is neither an occupancy polygon nor a guarantee of coverage.

The inspected ESPHome `tracking-ld2460.yaml` exposes these names; its component
publishes detection-range replies to the number entities, validates side-mode
limits above, and calculates target bearing as `atan2(x, y)`. The installation
mode select uses raw values `side` and `top`. A unique
`select.<prefix>*tracking_radar_installation_mode` must report `side` if present;
otherwise FOV rendering is suppressed, including for ambiguous/unavailable modes.
If absent, the existing card's side-mount assumption is used. Installation height
and downward tilt are deliberately not treated as horizontal bearing: ceiling
and floor-plane projection remain unsupported. Custom renamed entities may
prevent automatic discovery. No settings are sent to ESPHome by this feature.


## Responsive display and persistent sector settings (feature; no release)

The card uses a wide SVG viewport with equal X/Y scale and inverse screen
coordinates for pointer editing. It fills its available container up to 760 px
by default, 1100 px for `large`, or 1600 px for `full`. The old 520 px height cap
is removed. Mobile controls wrap and the drawing shrinks proportionally.
Existing explicit `range` values retain their scale; omitted `range` now defaults
to 6 m. The existing radar card remains a local single-sensor view. The separate
floorplan card below provides world placement for multiple sensors.

Open **Display sector settings** in the card for temporary live preview. For
persistent changes, use **Edit dashboard → Edit card → Display settings**, adjust
the same numeric fields/sliders, and **Save** the card/dashboard. The editor emits
Home Assistant's standard `config-changed` event containing the entire configuration;
it preserves unknown keys, flips, entities and layout settings. Reloading restores
saved Lovelace configuration, not temporary in-card previews. It does not use local
storage, guessed dashboard paths, private HA objects, or direct dashboard writes.
In YAML-managed dashboards, save these fields in the dashboard YAML instead.

```yaml
type: custom:jarvis-target-card
entity_prefix: sensor.office_
display_size: large             # standard | large | full
range: 6                       # viewport scale, 1..30 m, not detection range
display_start_angle: -45        # left boundary, -60..60 degrees
display_end_angle: 30           # right boundary, -60..60; must exceed left
display_min_range: 0.5          # display-only inner radius, 0..6 m
fov_range: 5                    # outer radius, >0..6 m; must exceed inner
```

Angles are radar-local: 0° is +Y and positive is toward +X. `flip_x` mirrors the
apparent left/right direction; it does not rewrite angle values or device coordinates.
Legacy `fov_angle` supplies symmetric defaults only when explicit boundaries are absent.
Invalid/nonfinite numbers, crossed boundaries and minimum ≥ maximum are rejected;
invalid form drafts never update the preview or saved configuration. Editing the
sector does not clip/filter targets, trails, polygon editing or firmware occupancy.

**Dashboard width is owned by Home Assistant.** `display_size` increases the drawing
cap; it cannot break out of a narrow parent column. In a Sections dashboard, the
card requests 12 columns by default and `full` columns for `display_size: full`;
existing explicit Layout/grid options override the request. Use HA's Layout tab
and widen the containing section as needed. For full dashboard width use a Panel
view containing this card. A Masonry column or nested stack still constrains width.
See [HA card sizing and editor contract](https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card/).

### LD2460 capabilities and separation

Inspection of Jarvis's vendored LD2460 driver at commit
`da1af1ff02de5fc6c80a1a3dc654e3ea605ff06a` found:

- `roomnode/vendor/ld2460/components/ld2460/ld2460.cpp`,
  `send_set_detection_range_command_`: command `0x11` encodes maximum distance
  in decimetres and independent signed start/end angles in tenths of a degree.
- `validate_detection_range_`: Side allows 0.1–6 m and
  −60° ≤ start < end ≤ 60°; Top allows 0.1–4 m and 0° ≤ start < end ≤ 360°.
- `number/__init__.py` exposes distance and both angles. Its generic angle
  bounds cover both mounting modes; they are not proof of Side-mode support
  beyond ±60°. Query `0x12` publishes reported limits back to number entities.
- There is no minimum-distance parameter in this command or inspected schema.

Thus maximum distance and independent angles are programmable in the inspected
firmware, but **these new controls intentionally configure the schematic display
only**. We did not verify physical hardware behavior. Hi-Link's nominal specification
is not a coverage guarantee. Top projection remains unsupported and suppresses both
sector overlays as before. The grey overlay reads the device's current Side limits.
The cyan display, grey reported device limits and occupancy polygons are independent.
**Apply to ESPHome still writes only the selected polygon text entity in millimetres**;
it never sends display settings or `number.set_value`.

### Validation

Run `node --check dist/jarvis-room-configurator.js`, `node --test tests/*.test.cjs`
and `python3 -m unittest discover -s tests -v`. For real DOM, pointer-transform,
responsive-layout and editor round-trip checks, run
`CHROME_BIN=/path/to/chrome node tests/browser-check.cjs`.
The fixture uses synthetic HA state and a service recorder; it never connects to HA.
See [validation results and limits](docs/responsive-display-validation.md).

## Ground-floor editor (feature; no release)

Add `type: custom:jarvis-floorplan-card` using the same JavaScript resource.
The separate **Jarvis Ground Floor** card includes the Blender metre geometry,
two independently movable/rotatable roomnodes and schematic radar sectors.
Edit card to change poses and hardware mappings, then save Lovelace to persist.
Kantoor/Keuken start at approximate annotated positions; height is unknown.
Live HA targets require dimension, pose and hardware-axis confirmations.
Ceiling mounting is recorded but ceiling/tilted projection is suppressed.

See [geometry provenance, image registration, configuration and calibration](docs/floorplan.md).
The existing radar card and its polygon-write behavior are unchanged. No HA
installation or device settings are altered by adding this source feature.
