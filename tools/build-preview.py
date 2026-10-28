#!/usr/bin/env python3
"""Build a self-contained manual-tool browser preview. Native ML remains APK-only."""
from pathlib import Path
import base64,hashlib
root=Path(__file__).resolve().parents[1]
assets=root/'app/src/main/assets'
html=(assets/'index.html').read_text(encoding='utf-8')
css=(assets/'style.css').read_text(encoding='utf-8')
html=html.replace('<link rel="stylesheet" href="style.css">','<style>'+css+'</style>')
html=html.replace('<link rel="stylesheet" href="studio.css">','<style>'+(assets/'studio.css').read_text(encoding='utf-8')+'</style>')
html=html.replace('<link rel="stylesheet" href="workbench.css">','<style>'+(assets/'workbench.css').read_text(encoding='utf-8')+'</style>')
portrait_data='data:image/png;base64,'+base64.b64encode((assets/'demo/mint-portrait.png').read_bytes()).decode()
html=html.replace('src="demo/mint-portrait.png"','src="'+portrait_data+'"')
hashes=[]
for name in ['manual-tools.js','selection-edit.js','repair-brush-core.js','advanced-tone.js','levels.js','levels-ui.js','geometry.js','perspective.js','perspective-operation.js','perspective-ui.js','straighten.js','straighten-operation.js','straighten-ui.js','local-adjustments.js','local-tone-operation.js','local-tone-ui.js', 'canvas-padding.js', 'canvas-padding-operation.js', 'canvas-padding-ui.js', 'paint-layer.js', 'paint-layer-operation.js', 'paint-layer-ui.js', 'text-overlay.js', 'text-overlay-operation.js', 'text-overlay-ui.js','sharpness.js','sharpness-operation.js','sharpness-ui.js','light-balance.js','light-balance-operation.js','light-balance-ui.js','preset-codec.js','preset-operation.js','preset-library.js','preset-ui.js','project-core.js','portrait-detail-engine.js','portrait-engine.js','portrait-people.js','beauty-protection.js','portrait-people-operation.js','face-detection.js','portrait-people-ui.js','manual-retouch-ui.js','image-overlay.js','photo-background.js','edge-refine.js','mask-refine.js','background-refine-operation.js','background-refine-ui.js','portrait-ui.js','advanced-tone-ui.js','viewport.js','viewport-ui.js','export-size.js','export-resize.js','redact-core.js','redact-operation.js','redact-ui.js','history-ui.js','image-overlay-operation.js','image-import.js','image-overlay-ui.js','collage-layout.js','collage-operation.js','collage-ui.js','project-library.js','project-library-controller.js','project-library-ui.js','project-backup.js','project-backup-transport.js','project-backup-ui.js','auto-tone.js','batch-core.js','batch-ui.js','ai-edit-core.js','ai-transport.js','ai-ui.js','studio-shell.js','editor.js']:
    script=(assets/name).read_text(encoding='utf-8')
    if name=='editor.js':
        image='data:image/png;base64,'+base64.b64encode((assets/'demo/astronaut.png').read_bytes()).decode()
        script=script.replace("'demo/astronaut.png'",repr(image))
        script=script.replace("'demo/mint-portrait.png'",repr(portrait_data))
    hashes.append("'sha256-"+base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()+"'")
    html=html.replace(f'<script src="{name}"></script>','<script>'+script+'</script>')
if '<script src=' in html:
    raise SystemExit('Preview contains an unembedded script; update the explicit module list.')
html=html.replace("script-src 'self'",'script-src '+ ' '.join(hashes))
out=root/'preview/薄荷修图-离线预览.html'
out.write_text(html,encoding='utf-8')
print(out)
