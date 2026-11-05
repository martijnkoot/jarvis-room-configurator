# Ground-floor prototype

Add a separate Lovelace card using the **same installed JavaScript resource**:

```yaml
type: custom:jarvis-floorplan-card
```

The visual editor supplies the full defaults when saving. Select **Jarvis Ground
Floor** in the card picker, or open Edit card after adding the YAML. Drag the
coloured circles to move; drag the white direction handles to rotate. Select
Kantoor or Keuken for numeric coordinates, heading, mounting, height, tilt and
schematic FOV controls. Numeric controls also provide keyboard access. The
invisible pointer areas stay large enough to grab at mobile widths. Save the
card/dashboard to persist, then reload to check the saved configuration. Changes
in an unsaved editor are drafts. YAML-managed dashboards require saving YAML.
No localStorage, private dashboard API, device service calls or automatic writes
are used by this new card. Existing `jarvis-target-card` configuration and polygon
writes retain their previous semantics.

## Geometry and evidence

`geometry/begane-grond.json` is the supplied Blender wall section on Z = 1.2 m,
not a newly invented room outline. Source: `begane_grond_v9.blend`, SHA-256
`6fc7a40c5f05131f868061994e6007c0ce44760628bec3be9dddb71438d8e800`.
The source Blender file was not needed again or modified in this phase; its
previously exported JSON was available. It reports metric scale 1 unit = 1 m,
bounds X = 3.244936943..8.444937706 and Y = -0.522855341..11.150891304 m.
The dimensions are 5.200 × 11.674 m **in the model**, not verified physical sizes.
Segments are preserved; room polygons, door/window semantics and wall occlusion
are deliberately not inferred. The geometry JSON still has no sensor positions.
`tools/embed-floor-geometry.py` embeds exactly this JSON in the single distributable
so HACS/manual users do not need to deploy extra assets or run a build.

Reference images are [original export](begane-grond-export.png) and
[user annotation](begane-grond-annotated.jpg). The cached chat supplied these
attachments as local temporary files, replacing its unavailable `/mnt/data` paths.
The annotation is 1120 × 590 px. Compare these outer landmarks:

| Blender world XY (m, rounded) | Original PNG pixel | Annotated pixel |
| --- | --- | --- |
| (8.44494, 11.15089) | (501, 85) | (85, 88) |
| (3.24494, 11.15089) | (85, 85) | (85, 504) |
| (3.24494, -0.52286) | (85, 1019) | (1019, 504) |

The top-right stepped wall outline and interior partitions also agree visually.
The original-export SVG formula was `p = 85 + 80*(X-Xmin)`,
`q = 85 + 80*(Ymax-Y)`. The annotation is consistent with a quarter turn
counterclockwise: `(u,v) = (q, 590-p)`, to about one pixel. The displayed
annotation registration is therefore:

```
u_px = 85 + 80 * (Ymax - Y)
v_px = 88 + 80 * (Xmax - X)
```

The SVG card uses metres `(U,V) = (Ymax-Y, Xmax-X)` rather than baking image
pixels into the building. Its inverse is `(X,Y) = (Xmax-V, Ymax-U)`; both axes
have exactly the same scale. This is an explicit **display registration**, not
geographic north. The ~1 px uncertainty implies ~1.25 cm in the image, before
annotation, mounting or building measurement errors. It is not survey accuracy.

Green at (414,135) seeds Kantoor at approximately world (7.8574,7.0384), looking
down on the annotation. Blue at (803,326) seeds Keuken at approximately
(5.4699,2.1759), looking left. These are approximate radar-dot locations, not
measured wall attachment points. Height is unknown (`null`), both placements
start uncalibrated and their positions remain adjustable.

World heading is explicitly **0° = +X, +90° = +Y**. Using the registered image
vectors gives initial Kantoor yaw 180° and Keuken yaw 90°. The earlier chat's
claim that image-down universally means 180° was incorrect: these values follow
from this specific registration and axis definition. Each sensor has its own yaw.

## Three separate data responsibilities

- Building: immutable source geometry, source hash and coordinate system.
- `placements`: stable sensor ID, label, world metres, yaw, wall/ceiling mounting,
  height, tilt, physical calibration and display-only FOV.
- `hardware`: keyed by placement ID, explicit HA target entity pairs, optional
  installation-mode entity, X/Y correction flips and axes confirmation.

Unknown configuration keys and Layout options survive editor round trips. Display
FOV radius (0.1–6 m) and independent local boundaries (−60..60°) do not program
hardware, alter occupancy or filter target slots. The sectors are schematic,
pass through walls and may be cropped at the map-focused viewport boundary.
Wall/zero-tilt sectors only; ceiling and tilted projection are unsupported and
suppressed. Selecting ceiling records the intended mount for future work.

## Calibration workflow

1. Check two independent physical dimensions (preferably perpendicular and far
   apart) against the model. If they disagree, correct/re-export geometry first;
   do not hide scale errors in sensor positions. Only then tick the dimensions
   confirmation. An image resize must not silently replace the registered scale.
2. Verify the three image landmarks above. If a different rotation/crop/export is
   used, derive and review a new registration from at least three non-collinear
   landmarks; do not reuse these pixel offsets or assume a compass heading.
3. Locate each radar origin using measured offsets from identifiable wall corners.
   Record its world X/Y, real mounting height and world yaw. The initial dot
   centres are only rough seeds. Record wall/ceiling and tilt independently.
4. For a horizontal wall-mounted sensor, record a person at three or more known,
   non-collinear positions: straight forward, to its left and to its right.
   Compare raw radar X/Y and units. Confirm +X right and +Y forward **after** any
   `flip_x`/`flip_y` correction; identify entity IDs from the existing ESPHome
   device, never from a guessed prefix. Avoid using a moving target for all checks.
5. Enter the explicit hardware map below. `axes_confirmed` is a user assertion
   requiring that check, not automatic evidence. If available, include the
   installation-mode select; anything except state `side` blocks projection.
6. Only after measurements agree, mark that sensor's pose calibrated. A height
   must be entered first. Changing position, yaw, height, mounting or tilt clears
   its pose confirmation. Ceiling/nonzero tilt remains blocked regardless of
   confirmations; no floor-height projection is claimed.
7. Save the Lovelace card/dashboard, reload and verify each sensor independently
   at the recorded points. Recheck after hardware remounting or firmware changes.
   No firmware or HA installation is changed by this development work.

Example hardware mapping (replace the **example** IDs with your actual entities):

```json
{
  "kantoor": {
    "axes_confirmed": false,
    "flip_x": false,
    "flip_y": false,
    "mode_entity": "select.example_kantoor_tracking_radar_installation_mode",
    "targets": [
      {"x_entity": "sensor.example_kantoor_tracking_target_1_x",
       "y_entity": "sensor.example_kantoor_tracking_target_1_y"}
    ]
  }
}
```

Each roomnode accepts up to five distinct pairs. Add Keuken as its own entry.
If no mode entity exists, the configured wall/zero-tilt pose is the explicit
assumption; the status cannot independently verify device mounting in that case.
Supported state units are `m`, `cm`, `mm`; missing/unknown units or unavailable
states are omitted immediately. Empty firmware slots at (0,0) and coordinates
outside the wall-mode 6 m radial bound are omitted. No synthetic target is shown.
Target slots are labelled per roomnode, not fused across sensors and not identities.
The horizontal formula is:

```
right = rawX * (flip_x ? -1 : 1)
forward = rawY * (flip_y ? -1 : 1)
worldX = sensorX + forward*cos(yaw) + right*sin(yaw)
worldY = sensorY + forward*sin(yaw) - right*cos(yaw)
```

This prototype has no floorplan occupancy editor, target history, sensor fusion,
height/tilt compensation, automatic calibration or confirmed physical-device run.
Live rendering consumes `hass.states` passively after the calibration gates;
existing radar settings remain owned by ESPHome.

## Validation (2026-11-05)

- Syntax check; 20 Node tests; 11 Python packaging/regression tests.
- Real Chrome at 390 and 1280 px: existing radar fixture 14 assertions each;
  floorplan fixture 18 assertions each plus real pointer drag/rotation checks.
- Tests cover three landmark registration, metre isometry/inverse, independent
  poses/flips, mixed units, live gates, unavailable/empty/out-of-range slots,
  ceiling suppression, invalid drafts, Lovelace echo/serialization, preservation
  of unknown options and zero HA service calls. Existing radar regressions pass.
- Desktop/mobile screenshots inspected locally. No HA instance connected, no
  ESPHome commands, no production dashboard edited. Browser simulation does not
  establish physical radar accuracy or real Lovelace persistence; calibration and
  the save/reload check above remain required in the installation.

Run the README checks plus:

```sh
CHROME_BIN=/path/to/chrome node tests/browser-check.cjs
# Optional local screenshots:
SCREENSHOT_DIR=/tmp/jarvis-floorplan-qa CHROME_BIN=/path/to/chrome node tests/browser-check.cjs
```
