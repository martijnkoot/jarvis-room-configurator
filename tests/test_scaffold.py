"""Static tests that can run without Home Assistant installed."""

import ast
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components" / "jarvis_room_configurator"


class ScaffoldTests(unittest.TestCase):
    def test_python_syntax(self):
        for path in COMPONENT.glob("*.py"):
            ast.parse(path.read_text(encoding="utf-8"), filename=str(path))

    def test_manifest(self):
        manifest = json.loads((COMPONENT / "manifest.json").read_text())
        self.assertEqual(manifest["domain"], "jarvis_room_configurator")
        self.assertEqual(manifest["version"], "0.6.0")
        self.assertTrue(manifest["config_flow"])

    def test_translation_json(self):
        for path in (COMPONENT / "translations").glob("*.json"):
            self.assertIn("config", json.loads(path.read_text()))
        self.assertIn("config", json.loads((COMPONENT / "strings.json").read_text()))

    def test_no_device_side_effects(self):
        setup = (COMPONENT / "__init__.py").read_text()
        self.assertNotIn("async_call", setup)
        self.assertNotIn("async_create_task", setup)
        self.assertNotIn("async_register_service", setup)


if __name__ == "__main__":
    unittest.main()
