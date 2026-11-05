"""Dashboard distribution checks; no Home Assistant dependency."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class PackagingTests(unittest.TestCase):
    def test_dashboard_distribution(self):
        config = json.loads((ROOT / "hacs.json").read_text())
        self.assertEqual(config["filename"], "jarvis-room-configurator.js")
        self.assertTrue((ROOT / "dist" / config["filename"]).is_file())
        self.assertFalse((ROOT / "custom_components").exists())

    def test_license(self):
        self.assertTrue((ROOT / "LICENSE").is_file())
