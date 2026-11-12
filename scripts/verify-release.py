from pathlib import Path
import json,zipfile,hashlib,xml.etree.ElementTree as ET
root=Path(__file__).resolve().parent.parent
release=root/'releases/MEGATRON-v1.0.0.zip'
extension=root/'releases/megatron-mission-control-1.0.0.vsix'
for path in (release,extension):
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None
        names=archive.namelist()
        assert not any('/tools/' in n or n.startswith('tools/') or n.endswith('.sqlite') or n.endswith('/.env') for n in names)
        if path==release:
            assert json.loads(archive.read('package.json'))['name']=='megatron'
            for item in ('src/engine.ts','web/app.js','docs/MEGATRON-Product-Guide.pdf','assets/screenshots/mission-control.png','assets/demo/megatron-walkthrough.webm','assets/brand/whale.svg','assets/brand/whale-mark.png','assets/brand/social-card.png','assets/brand/ATTRIBUTION.txt','tests/foundation.test.ts'):assert item in names,item
        else:
            assert json.loads(archive.read('extension/package.json'))['name']=='megatron-mission-control'
            ET.fromstring(archive.read('extension.vsixmanifest'))
    print(f'Validated {path.name}: ZIP CRCs, intended content, manifest, and excluded state')
for line in (root/'releases/SHA256SUMS.txt').read_text().splitlines():
    digest,name=line.split('  ');assert hashlib.sha256((root/'releases'/name).read_bytes()).hexdigest()==digest
print('Release checksums match.')
import fitz
guide=fitz.open(root/'docs/MEGATRON-Product-Guide.pdf')
assert guide.page_count>=10
assert 'MEGATRON' in guide.metadata['title']
text='\n'.join(page.get_text() for page in guide)
for expected in ('Plan-to-code traceability','How to use MEGATRON','Architecture','HTTP API','Testing'):
    assert expected in text,expected
print(f'PDF guide validated: {guide.page_count} readable pages and all operating sections.')
