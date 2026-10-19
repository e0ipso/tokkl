#!/usr/bin/env python3
"""Put clean local colors behind sparse traced palette details to avoid dark gaps."""
from copy import deepcopy
from pathlib import Path
import os
import xml.etree.ElementTree as ET
NS='http://www.w3.org/2000/svg'
ET.register_namespace('',NS)
pack=Path(os.environ.get('TOKKL_PACK_DIR', 'outputs/tokkl-wordmark-pack')) / 'svg'
detailed=ET.parse(pack/'tokkl-wordmark-detailed.svg')
root=detailed.getroot()
clean=ET.parse(pack/'tokkl-wordmark-clean.svg').getroot()
# Idempotent when refining the clean artwork.
for element in list(root):
    if element.get('id') in ('local-colors','local-color-gradients'):
        root.remove(element)
defs=deepcopy(clean.find(f'{{{NS}}}defs'))
defs.set('id','local-color-gradients')
root.insert(3,defs)
underlay=ET.Element(f'{{{NS}}}g',{'id':'local-colors','clip-path':'url(#artwork)'})
for path in clean.findall(f'{{{NS}}}path')[1:]:
    underlay.append(deepcopy(path))
# Place immediately before the palette group, after the navy silhouette.
position=next(i for i,e in enumerate(root) if e.tag==f'{{{NS}}}g')
root.insert(position,underlay)
root.find(f'{{{NS}}}desc').text='Detailed 96-color vector trace over local gradient colors. Fine paint texture is approximated with editable filled paths. No fonts, external assets, or embedded raster images.'
ET.indent(detailed,space='  ')
detailed.write(pack/'tokkl-wordmark-detailed.svg',encoding='unicode')
with (pack/'tokkl-wordmark-detailed.svg').open('a') as output: output.write('\n')
print('Added clean local-color underlay to detailed SVG.')
