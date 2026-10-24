"""Read the installed ASAR archive without modifying Obsidian."""
import json
import struct
from pathlib import Path

archive = Path.home() / 'Library/Application Support/obsidian/obsidian-1.14.4.asar'
output = Path('/tmp/obsidian-runtime')
targets = {
    'app.css', 'lib/codemirror/codemirror.js', 'lib/codemirror/meta.min.js',
    'lib/codemirror/modes.min.js', 'lib/codemirror/markdown.js', 'lib/prism.min.js',
}
with archive.open('rb') as f:
    header = struct.unpack('<4I', f.read(16))
    tree = json.loads(f.read(header[3]))
    data_offset = 8 + header[1]
    for target in sorted(targets):
        node = tree
        for part in target.split('/'):
            node = node['files'][part]
        f.seek(data_offset + int(node['offset']))
        path = output / target
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(f.read(node['size']))
print(f'Extracted {len(targets)} read-only runtime assets to {output}')
