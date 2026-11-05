# Responsive display validation — 2026-11-05

Base: `fe1c2c3` (main, merged PR #2). No release or HA installation change.

- JavaScript syntax check passes.
- 14 Node behavior tests pass, including previous flips, animation/trails,
  firmware occupancy, polygon editing and selected-entity write contracts.
- 11 Python distribution/contract checks pass.
- Real Chrome DOM: 13 checks pass at each of 390 px and 1280 px. The fixture
  checks responsive sizing, overflow including expanded controls, screen-to-SVG
  pointer coordinates, both sectors, firmware occupancy, independent number/slider
  controls, invalid drafts, editor event preservation/echo, serialized config
  recreation, no display service writes and unchanged polygon Apply payload.
- Mobile and desktop screenshots were visually inspected. Controls wrap and the
  larger landscape drawing preserves equal scale. No runtime dependencies added.
- Whitespace check passes. CI repeats syntax, Node, Python and browser checks.

Reproduce from the repository root:

```sh
node --check dist/jarvis-room-configurator.js
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -v
CHROME_BIN=/path/to/chrome node tests/browser-check.cjs
```

`tests/browser.html` is also a standalone local acceptance fixture. It uses only
synthetic state and recorded service calls. The runner creates an isolated temporary
Chrome profile; Node 22+ and Chrome/Chromium are required.

Limits: these checks simulate the Lovelace editor's documented `config-changed`
contract and reload the serialized configuration. They do not prove that a specific
HA version/theme/layout saves it correctly. Follow-up installation acceptance:
save the card in HA's editor, reload, verify all saved values, check the containing
section/Panel width, and confirm real device sectors/targets/polygons. No hardware
range programming or ceiling projection was attempted. Source inspection proves
what the driver sends/validates, not physical detection performance.
