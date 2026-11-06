# Integrated floorplan

1. Add **Jarvis Ground Floor**, then open its visual card editor.
2. Click a coloured sensor icon. Choose its roomnode device in the source list.
   If registry access is unavailable, choose one target X or Y entity instead.
   Every matching target pair is linked automatically. Use **Add sensor** for an
   additional roomnode; existing placements and unknown Lovelace options survive.
3. Drag the icon to its position. Drag the white direction handle to rotate.
   Numeric position, rotation and visual distance scale provide keyboard access.
   Give it a recognisable name and choose wall or ceiling mounting.
4. Watch the live targets. Adjust mirrors if the source axes need correction.
   Use **Mark placement as visually checked** when the display agrees with the
   room. This clears the warning; it is never required to reveal targets.
5. Save the card/dashboard, reload, and check both roomnodes. Unsaved editor
   changes remain drafts; the viewer never writes the dashboard behind your back.

At runtime, clicking an icon opens its source summary and polygon tool. To edit
persistent placement/settings, use the Lovelace editor; this follows HA's Save
workflow and works with YAML dashboards when their YAML is saved separately.

## Source resolution and diagnoses

The frontend requests HA entity and device registries once per connection using
`config/entity_registry/list` and `config/device_registry/list`. Entities are
scoped to the selected device, disabled entries are excluded, and original names,
unique IDs and state friendly names allow renamed entity IDs to be recognised.
No private dashboard API, backend integration or extra inventory service is used.
The **Refresh device discovery** button retries after registry or firmware changes.

The fallback uses the exact source stem preceding `target_N_x/y`. The observed
Kantoor example is
`sensor.kantoor_jarvis_roomnode_esp_test_tracking_target_1_x` and its `_y` partner.
Read-only inspection of HA's States page on 2026-11-06 confirmed Keuken uses
`sensor.jarvis_roomnode_keuken_tracking_target_1_x/y` through target 5, in metres.
Its presence source is `binary_sensor.jarvis_roomnode_keuken_tracking_presence`;
polygon texts use `text.jarvis_roomnode_keuken_polygon_zone_1` (1–4) and
`polygon_exclusion_1` (1–2). These entities were unavailable at inspection time.
Tests cover both naming stems and renamed registry entries. No HA state,
dashboard, resource or hardware settings were changed during inspection.

Duplicate axes or polygons are not resolved by picking the first match. Missing
or ambiguous pairs produce a diagnosis; remaining complete pairs still render.
If registry access fails, a device-only source explains the entity fallback.
A renamed anchor without registry metadata cannot be safely inferred. Restore
registry access rather than selecting unrelated entities. Occupancy and counts
come from reported entities, never from the number of rendered markers.

Coordinates require `m`, `cm` or `mm`; unavailable values, empty slots (0,0), and
positions outside 6 m do not produce a marker. The status distinguishes invalid
units/unavailable axes from an empty slot. No targets from another device are
silently substituted. Advanced explicit `hardware.targets` mappings remain
readable for compatibility, but the normal editor never asks for them.

## Movement and geometry

Each source/target pair owns its own interpolation state. The default visual
smoothing time constant is 180 ms; 0 disables it. Trails default to 8 seconds,
0 disables them. A lost target removes its marker immediately and its old path
fades; reusing that slot begins a new trail. Samples are bounded to 120 per
slot and grouped into eight SVG opacity bands. One frame loop serves the map
and stops when disconnected. Display motion does not establish person identity,
tracking accuracy or cross-sensor fusion.

The sensor transform applies mirrors, visual distance scale and yaw once to
coordinates, polygons and hardware overlays. The floorplan continues to use the
reviewed Blender geometry, model metres and independent sensor poses. Its current
geometry ID is `begane-grond-v9`; arbitrary house geometry and multiple-floor
switching are not implemented here. Placement/source settings remain independent
of geometry so a future geometry provider need not change device discovery.

Wall/zero tilt uses the established horizontal projection. Ceiling and tilted
poses are saved, with a visible unsupported-projection message rather than an
invented height correction. Height is optional in wall mode. Selecting ceiling
in the display never changes the radar's physical installation-mode entity.

## Polygons and hardware

Expand **Edit ESPHome polygons / hardware view** in the sensor panel. Existing
zone colours, counts, detection/exclusion drawing, vertex dragging, firmware
millimetre serialization, and **Apply to ESPHome** use the existing polygon
engine with device-scoped entity resolution. Draft edits never write. Apply
writes only the selected uniquely resolved `text` entity. Readback retains the
existing optimistic-state limitation; check actual persistence after a device
restart separately. Display placement and scale never rewrite raw polygons.

Main-map polygons use the same projection as targets. Coloured translucent FOV
is the display sector; dashed grey is the uniquely resolved hardware sector.
Neither includes wall occlusion or guarantees coverage. Occupancy is diagnostic,
not a filter that hides potentially useful live measurements.
