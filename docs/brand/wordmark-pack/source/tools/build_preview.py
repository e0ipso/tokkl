#!/usr/bin/env python3
"""Create the light/dark proof sheet from exported transparent PNGs."""
from pathlib import Path
import os
from PIL import Image, ImageDraw, ImageFont

pack=Path(os.environ.get('TOKKL_PACK_DIR','outputs/tokkl-wordmark-pack'))
sheet=Image.new('RGB',(1440,1060),'#e9e3dc')
draw=ImageDraw.Draw(sheet)
try:
    fontpath='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    titlefont=ImageFont.truetype(fontpath,30)
    font=ImageFont.truetype(fontpath,21)
    small=ImageFont.truetype(fontpath,17)
except OSError:
    titlefont=font=small=ImageFont.load_default()
draw.text((36,24),'Tokkl / clock O wordmark',font=titlefont,fill='#08061f')
draw.text((36,68),'Vector variants on light and dark backgrounds',font=small,fill='#51485a')
rows=[
    [('detailed','Detailed / painted texture','#fff8ed'),('detailed','Detailed / painted texture','#2e1428')],
    [('clean','Clean / gradients','#fff8ed'),('clean','Clean / gradients','#2e1428')],
    [('mono-dark','Single ink / black','#fff8ed'),('mono-white','Single ink / white','#2e1428')],
]
for row,columns in enumerate(rows):
    top=112+row*310
    for col,(variant,label,bg) in enumerate(columns):
        left=36+col*704
        draw.text((left,top),label,font=font,fill='#08061f')
        tile=Image.new('RGBA',(668,258),bg)
        im=Image.open(pack/f'png/tokkl-wordmark-{variant}-1280.png').convert('RGBA')
        im.thumbnail((644,246),Image.Resampling.LANCZOS)
        tile.alpha_composite(im,((668-im.width)//2,(258-im.height)//2))
        sheet.paste(tile.convert('RGB'),(left,top+36))
(pack/'previews').mkdir(exist_ok=True)
sheet.save(pack/'previews/contact-sheet.png')
