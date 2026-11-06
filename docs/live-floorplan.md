# Live floorplan arranging and zones

This feature addresses the reported screenshot scenario: the live map remains usable, with no modal sensor sidebar and no second, sensor-local editing canvas. Select **Inrichten**, then **Sensor plaatsen** or **Zone bewerken**. Pan explicitly changes navigation mode; +/− and Fit remain available. Choose the sensor and detection/exclusion slot in the compact map toolbar. All discovered sensors and polygons remain overlaid. Zone fills can be selected on the map; the dropdown also makes overlapping zones accessible.

## What is actually stored

| Operation | Result |
| --- | --- |
| Select a sensor | Live selection only, no writes |
| Drag sensor / direction handle in Inrichten | In-memory placement preview, calibration invalidated |
| Bewaren / export | Full card JSON shown for copying; downloadable JSON backup available. **Does not save Home Assistant** |
| Paste exported JSON into Dashboard → Edit card → Code editor → Save | Official Home Assistant card configuration route; JSON is valid YAML. This is the durable placement save step, also suitable for YAML-managed dashboards via their normal file workflow |
| Draw / move / remove zone vertices, clear zone | In-memory raw sensor-coordinate preview only; not part of placement export |
| Apply to ESPHome | Confirmation names sensor, slot, entity and exact millimetre payload; one `text.set_value` service call after confirmation |
| Herlaad zone | Discards preview and reads the current HA entity state |
| Herstel vorige | Explicit, confirmed service write of the previous entity value; one previous value retained per last applied entity, only for this card session |
| Annuleren | Restores placement snapshot; discards zone preview. Does not undo hardware writes |
| Reload dashboard / new setConfig | External configuration wins. Unexported placement and zone previews are lost |

The documented [custom card](https://contributors.home-assistant.io/frontend/custom-ui/card/) contract provides `setConfig`; the [card editor](https://contributors.home-assistant.io/frontend/custom-ui/card-editor/) publishes `config-changed` for Home Assistant's editor to save. These documents do not provide a supported live-card server save interface. This implementation deliberately does not use private Lovelace objects, direct `lovelace/config/save`, browser local storage presented as server persistence, or an unhandled live `config-changed` event. **There is no one-click server placement save in normal live mode.** A backend integration could provide that in a later feature.

## Coordinates and limits

`floorProject` and `floorUnproject` are mathematical inverses: yaw rotates local forward +Y and right +X into canonical world XY; both flips and configured scale are included. World ↔ map registration is independent. Screen coordinates use inverse SVG screen matrices, so zoom, pan, aspect fitting and CSS size are accounted for. Drafts stay in raw sensor metres and serialize to integer millimetres for the resolved ESPHome text entity. Moving a sensor moves its associated local zone preview with it; it does not rewrite device polygons.

Wall mounting with zero tilt and Side device mode is supported. Ceiling/nonzero-tilt placement can be shown, but zone editing and projected targets remain unsupported. Geometry and physical alignment still need calibration. Zones must be empty or have 3–20 finite points within the LD2460 6 m / ±60° hardware sector; entity text length is checked. Display FOV may be narrower than hardware FOV. An external entity change blocks Apply until Reload. Missing, ambiguous or unavailable entities are not writable. Service failures retain the draft. ESPHome text states are optimistic: neither service success nor state echo proves physical application or correct occupancy.

Live targets, smoothing, trails, mixed units, registry discovery, floorplan image replacement and official editor property controls remain in place. Legacy element stays registered for migration compatibility; it is not embedded as a second canvas.

## Validation

Run `node --test tests/*.test.cjs`, `python3 -m unittest discover -s tests`, and `CHROME_BIN=... node tests/browser-check.cjs`.

The browser fixture uses synthetic HA states/registries/services, including renamed entities. It exercises the reported two-sensor ground-floor scenario at 390 and 1280 px, actual pointer translation/rotation/vertex dragging on the live card, touch vertex dragging on mobile, cancellation, confirmed/cancelled hardware calls, and export. It also retains editor, target, image replacement, pan/zoom and theme regression checks. Screenshots in `live-screenshots/` are browser fixture renders, not a connected Home Assistant installation. No production HA or ESPHome was accessed. Real Lovelace save/reload and physical device validation remain outstanding.
