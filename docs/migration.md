# Safe migration to one floorplan

This is a dashboard-only migration. Do not remove ESPHome devices/entities,
firmware zones, the JavaScript resource, or a running HA integration as part of it.

1. Back up the dashboard YAML, including each old `custom:jarvis-target-card`
   configuration and the existing `custom:jarvis-floorplan-card`. Record the
   installed release so the original resource can be restored if necessary.
2. After deliberately installing the new plugin version, keep the same module
   resource path and refresh the browser cache (a query suffix can be bumped).
   Add/open **Jarvis Ground Floor**. Existing floorplan placements, explicit
   mappings and unknown options remain compatible; no migration runs on HA.
3. Select the corresponding sensor. Expand **Import settings from an old radar
   card** and paste that card's flat YAML or JSON. Click **Import into selected
   sensor**. Flips, smoothing, trail duration, asymmetric FOV boundaries, minimum
   range and source prefix transfer; the entire original card is also retained
   under `hardware.<sensor>.legacy_card` for rollback. Nested custom options can
   be imported as JSON; unsupported YAML is rejected rather than partly applied.
4. Choose the actual roomnode device to replace the naming-prefix fallback.
   This clears explicit target mappings in favour of automatic discovery.
   Check the discovered pair count, unavailable/ambiguous messages, presence and
   polygon outlines. Repeat for Keuken using its own source. Sensor-local radar
   polygons remain accessible under the integrated sensor panel.
5. Set each sensor's physical position and heading on the floorplan. The old
   radar-local viewport has no world placement to infer; compare known positions
   visually, adjust display distance scale if necessary, then save in Lovelace.
6. Reload and verify each source independently, including mirrors, smoothing,
   lost-target handling and polygon availability. Confirm the saved placement
   and source survive reload. You do not need to apply polygons to migrate.
7. Only after that check, remove the old individual dashboard cards and save.
   Keep the module resource: it serves the new floorplan too. The old runtime
   element remains available for existing saved configurations, but is absent
   from the card picker. No automatic resource deletion or dashboard rewrite runs.

To roll back, restore the previous plugin release/resource, restore the backed-up
card YAML, and refresh the browser. Merely reverting plugin code does not restore
an already edited dashboard, which is why the YAML backup matters. Polygon data
stays on ESPHome; display import/removal does not change it.

## Workspace UI after PR #5

No configuration migration is required. Existing geometry, placements, hardware
links and unknown Lovelace options remain readable. `floorplan_image` is an optional
image URL and transform; its absence (or null) uses the bundled drawing. Replacing
the image changes neither sensor poses nor device polygons. Keep a copy of the
previous dashboard configuration to roll back an image URL/transform; restoring
the original drawing does not reset sensors. See [the workspace guide](floorplan-workspace.md).
