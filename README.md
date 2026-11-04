# Jarvis Room Configurator

An optional Home Assistant configuration and diagnostic tool for ESPHome LD2460 roomnodes.

## v0.3.1 — read-only target viewer with independent X/Y flips

This version registers an optional Home Assistant integration and serves a
read-only Lovelace target card. It does **not** write device settings or zones.
It intentionally does not replace the SmartHomeShop integration.

## Install for local development

1. Unzip/copy `custom_components/jarvis_room_configurator/` to the Home Assistant
   configuration directory as `custom_components/jarvis_room_configurator/`.
2. Restart Home Assistant.
3. Go to **Settings → Devices & services → Add integration** and search for
   **Jarvis Room Configurator**.
4. Confirm the setup dialog.

This can be used alongside the existing ESPHome integration. It creates no
entities and has no ongoing tasks.

## HACS / repository hosting

This is structured like a HACS custom integration, but no HACS installation or
GitLab-hosted installation has been verified. Confirm supported hosting before
planning distribution; a GitHub mirror may be needed.

## Next milestones

- v0.2: read-only inventory of LD2460 ESPHome target/zone entities and live target view.
- v0.3: edit polygons and exclusions with explicit preview/apply/readback verification.
- Later: floor plan, common coordinate system, multiple sensors and overlap analysis.

## Licensing

This scaffold contains newly authored project code; no SmartHomeShop source
files are copied. Choose and add a LICENSE before publishing the repository.

## Configuration safety

See [ADR-001](docs/ADR-001-independence.md).

## v0.2.0 — live target plot (read-only Lovelace card)

After installing the integration and restarting Home Assistant:

1. Add a **JavaScript module** dashboard resource with URL
   `/jarvis_room_configurator/target-card.js` (Settings > Dashboards > three-dot menu > Resources, depending on HA version).
2. Add a manual dashboard card:

   ```yaml
   type: custom:jarvis-target-card
   title: Kantoor — LD2460
   entity_prefix: sensor.kantoor_
   range: 5
   ```

   Set `entity_prefix` to a prefix that matches **only one** roomnode's
   `sensor.*tracking_target_1_x` / `_y` entities. Check Developer Tools > States
   for the actual entity names. `range` is a display scale in metres, *not*
   a radar range adjustment. There is no automatic room discovery yet.
3. Confirm that target entities report a `unit_of_measurement` of `m`, `cm`,
   or `mm`. Unsupported or absent units are deliberately not plotted.

The display reads `hass.states` only. It does not create HA entities, send
commands, persist zones, or alter the firmware. It is a wall/side-oriented
radar-local view (positive X right; positive Y forward), **not yet a floor plan**.
Top/ceiling mounting needs its own coordinate display and calibration; do not
use this display to determine ceiling-zone geometry until that is implemented.

**Limitations:** The HA custom integration doesn't automatically install the
Lovelace dashboard card. Target IDs and units have not yet been verified against
our live roomnodes. The frontend has not been installed/tested inside HAOS/UTM.
Removing the integration leaves the radar and HA automations untouched; remove
its Lovelace card and dashboard resource separately to clean up the UI.

## v0.3.0 — radar at top (optional vertical flip)

Set `flip_y: true` in the existing manual dashboard card to put the radar
at the **top** and targets below it while preserving left/right orientation:

```yaml
type: custom:jarvis-target-card
title: Kantoor — LD2460
entity_prefix: sensor.kantoor_
range: 5
flip_y: true
```

The default (`flip_y: false`) retains the original v0.2.0 view. This setting
changes **only** the chart orientation; it does not physically move the radar,
change target coordinates, or write any ESPHome settings. If the browser caches
the old card, bump the dashboard resource URL to
`/jarvis_room_configurator/target-card.js?v=0.3.0` and reload the dashboard.

The detection-sector and polygon overlays remain planned work, not part of v0.3.0.

## v0.3.1 — rotate office view 180 degrees

If the radar should appear at the top and left/right should also be reversed, use:

```yaml
type: custom:jarvis-target-card
title: Kantoor — LD2460
entity_prefix: sensor.kantoor_
range: 5
flip_x: true
flip_y: true
```

For the new frontend, update the dashboard resource query to
`/jarvis_room_configurator/target-card.js?v=0.3.1` and refresh the dashboard.
The flips only affect the rendered coordinates, never sensor data or device settings.

## v0.4.0 — polygon editing and smoother targets (experimental)

This builds on the tested office orientation (`flip_x: true`, `flip_y: true`).

```yaml
type: custom:jarvis-target-card
title: Kantoor — LD2460
entity_prefix: sensor.kantoor_
range: 5
flip_x: true
flip_y: true
smoothing_ms: 180
```

Update the JavaScript module resource to
`/jarvis_room_configurator/target-card.js?v=0.4.0` and refresh the browser.

The editor **requires the existing ESPHome polygon package**. It discovers
`text.<roomnode-prefix>*polygon_zone_{1..4}` and
`text.<roomnode-prefix>*polygon_exclusion_{1..2}`. The `entity_prefix` must
isolate **one** roomnode, not multiple ESPs.

1. Select detection zone 1–4 or exclusion zone 1–2.
2. Click **Draw new**, click points in the radar plane (max 20), then **Finish**.
3. Drag blue vertices to refine a polygon. **Clear** previews an empty polygon;
   **Reload** discards the preview.
4. Click **Apply to ESPHome** to update the chosen `text` entity through
   Home Assistant's `text.set_value` service. The firmware stores the
   semicolon-separated `Xmm:Ymm` values (`1000:500;...`). It is not stored in
   the configurator. ESPHome template text entities are optimistic; to verify
   persistence, inspect the entity state and reboot the roomnode.

If the save button is disabled or reports missing entities, inspect
**Developer Tools → States** for the `text.*polygon_zone_1` entities. An
ESPHome firmware build without the polygon package cannot be edited here.

`smoothing_ms` is a purely visual time constant in milliseconds (0 disables
interpolation). It does not add sensor measurements, change ESPHome reporting,
or improve inherent target tracking accuracy. Use 120–250 ms as a starting
point; higher values look smoother but lag more. If identification of separate
people is unstable, visual interpolation cannot correct the tracker itself.

Limitations: manual Lovelace card; not yet integrated with a dedicated HA panel.
The polygon editor is not yet tested against HAOS in UTM. Firmware writes have
not yet been live-tested. For this version, side/wall mode with forward-positive
Y is assumed. Ceiling mounting requires separate projection support. There is
no automated runtime rollback or independently confirmed radar readback.

## v0.5.0 — fading target trails

The radar plot now shows a short movement trail for every detected target. Older
segments fade over time; the smoothing setting remains independent. Trails are
visual-only, never stored in Home Assistant and never sent to ESPHome.

```yaml
type: custom:jarvis-target-card
title: Kantoor — LD2460
entity_prefix: sensor.kantoor_
range: 5
flip_x: true
flip_y: true
smoothing_ms: 180
trail_seconds: 8
```

Set `trail_seconds: 0` to disable trails, or 1–60 seconds for longer/shorter
paths. Tracking target IDs may be reused after lost detection; trails indicate
reported target positions, **not confirmed identity**. A single target's trail
can be affected by radar reflections, occlusions and tracking-ID switches.

Update the dashboard JavaScript resource URL to
`/jarvis_room_configurator/target-card.js?v=0.5.0` after replacing the
custom integration directory, and refresh the dashboard.

## v0.6.0 — simultaneous zones and live count legend

All configured detection (four) and exclusion (two) polygons are drawn at once.
Detection 1–4 use distinct colors; exclusion polygons remain dashed red.
A detection polygon with a reported target count above zero receives a stronger fill.
The legend shows each zone and its current count when exactly one matching
`sensor.*polygon_zone_N_target_count` or `sensor.*zone_N_target_count` exists.
Otherwise it reports `count unavailable` rather than guessing. This is an
**entity naming assumption** to verify against the real LD2460 roomnode.

Upgrade the installed integration folder and set the Lovelace module resource
URL to `/jarvis_room_configurator/target-card.js?v=0.6.0`, then reload the dashboard.
The card configuration (including `flip_x`, `flip_y`, `trail_seconds`) is unchanged.

**Removal test:** Remove the dashboard card and dashboard resource, then uninstall
the custom integration. Restart HA and power cycle the roomnode. Check that
zone text entities, presence and counts still work with no configurator installed.
Record observed results; this has not yet been tested against the live installation.
