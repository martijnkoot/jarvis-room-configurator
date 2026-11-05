"""Embed the reviewed metre geometry; run from repository root, no build dependency."""
import json
from pathlib import Path
p = Path('dist/jarvis-room-configurator.js')
s = p.read_text()
start = '// BEGIN GENERATED FLOOR GEOMETRY (tools/embed-floor-geometry.py)'
end = '// END GENERATED FLOOR GEOMETRY'
a, rest = s.split(start)
_, b = rest.split(end)
data = json.loads(Path('geometry/begane-grond.json').read_text())
p.write_text(a + start + '\nconst jarvisGroundFloor=' + json.dumps(data, separators=(',', ':')) + ';\n' + end + b)
