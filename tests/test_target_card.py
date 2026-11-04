"""Static packaging and first-pass editor tests."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
CARD=ROOT/'custom_components/jarvis_room_configurator/frontend/target-card.js'

class CardTests(unittest.TestCase):
    def test_card_exists(self): self.assertTrue(CARD.is_file())
    def test_target_read(self):
        source=CARD.read_text()
        self.assertIn('set hass(hass)',source)
        self.assertIn('tracking_',source)
        self.assertIn('unit_of_measurement',source)
    def test_flip_both_axes(self):
        source=CARD.read_text()
        self.assertIn("this._config.flip_x?-1:1",source)
        self.assertIn("this._config.flip_y?1:-1",source)
    def test_zone_slots(self):
        source=CARD.read_text()
        self.assertIn('polygon_zone_',source)
        self.assertIn('polygon_exclusion_',source)
        self.assertIn("kind==='zone'?4:2",source)
    def test_explicit_write_only(self):
        source=CARD.read_text()
        self.assertIn("this._hass.callService('text','set_value'",source)
        self.assertNotIn('setInterval(',source)
        self.assertNotIn('fetch(',source)
    def test_smoothing(self):
        source=CARD.read_text()
        self.assertIn('smoothing_ms',source)
        self.assertIn('requestAnimationFrame',source)
    def test_versioned_documentation(self):
        self.assertIn('v0.6.0',(ROOT/'README.md').read_text())

    def test_trail_configuration_and_fading(self):
        source=CARD.read_text()
        self.assertIn('trail_seconds:8',source)
        self.assertIn('trail_seconds must be 0..60',source)
        self.assertIn('_drawTrail(',source)
        self.assertIn('now-b.t',source)
        self.assertIn('this._trails.delete(id)',source)
        self.assertIn('trail.length>240',source)

    def test_legend_and_occupancy(self):
        source=CARD.read_text()
        for marker in ('_zoneCount(n)', '_updateLegend(legendZones)', 'polygon_zone_${n}_target_count', 'count unavailable', 'occupied', "'#2563eb'"):
            self.assertIn(marker, source)
