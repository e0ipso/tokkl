#!/usr/bin/env python3
"""Build simplified gradient and single-ink artwork from the generated master."""
from pathlib import Path
import os
import json
import matplotlib.pyplot as plt
import numpy as np
from scipy import ndimage
from PIL import Image
from trace_wordmark import simplify, remove_small

PACK = Path(os.environ.get('TOKKL_PACK_DIR', 'outputs/tokkl-wordmark-pack'))
SOURCE = PACK / 'source/tokkl-wordmark-clock-master.png'


def fill_small_holes(mask, area):
    labels, _ = ndimage.label(~mask)
    sizes = np.bincount(labels.ravel())
    boundary = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    fill = sizes <= area
    fill[boundary] = False
    fill[0] = False
    return mask | fill[labels]


def curve_path(mask, tolerance=1.0):
    figure, axes = plt.subplots(figsize=(1, 1))
    contours = axes.contour(np.pad(mask.astype(float), 1), levels=[.5])
    chunks=[]
    vertices=0
    for ring in contours.allsegs[0]:
        ring=simplify(ring-1, tolerance)
        if np.allclose(ring[0],ring[-1]): ring=ring[:-1]
        if len(ring)<3: continue
        # Cubic interpolating spline follows simplified subpixel contours.
        chunks.append('M%.2f,%.2f' % tuple(ring[0]))
        for index in range(len(ring)):
            before=ring[(index-1)%len(ring)]
            start=ring[index]
            end=ring[(index+1)%len(ring)]
            after=ring[(index+2)%len(ring)]
            control1=start+(end-before)/6
            control2=end-(after-start)/6
            chunks.append('C%.2f,%.2f %.2f,%.2f %.2f,%.2f' % (*control1,*control2,*end))
        chunks.append('Z')
        vertices+=len(ring)
    plt.close(figure)
    return ''.join(chunks),vertices


def svg_start(width,height,description):
    return [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width+48}" height="{height+48}" viewBox="-24 -24 {width+48} {height+48}" role="img" aria-labelledby="title">',
            '<title id="title">Tokkl wordmark with clock O</title>',f'<desc>{description}</desc>']


def main():
    image=np.array(Image.open(SOURCE).convert('RGBA'))
    height,width=image.shape[:2]
    alpha=image[:,:,3]>127
    outline=remove_small(alpha,300)
    outline=ndimage.gaussian_filter(outline.astype(float),1.4)>.5
    outline_path,_=curve_path(outline,1.2)
    colored=(image[:,:,:3].max(axis=2)>85)&alpha
    colored=ndimage.binary_closing(colored,iterations=2)
    colored=remove_small(colored,500)
    colored=fill_small_holes(colored,400)
    colored=ndimage.gaussian_filter(colored.astype(float),1.4)>.5
    labels,_=ndimage.label(colored)
    areas=np.bincount(labels.ravel())
    components=[]
    for label in np.argsort(-areas[1:])+1:
        if areas[label]<500:continue
        mask=labels==label
        ys,xs=np.where(mask)
        path,vertices=curve_path(mask,1.0)
        bounds=[int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max())]
        median=np.median(image[:,:,:3][mask],axis=0).astype(int)
        components.append({'area':int(areas[label]),'bounds':bounds,'path':path,'vertices':vertices,'median':median.tolist()})
    defs='''<defs>
<linearGradient id="t" gradientUnits="userSpaceOnUse" x1="350" y1="55" x2="200" y2="720"><stop offset="0" stop-color="#ffe900"/><stop offset="0.42" stop-color="#ffab00"/><stop offset="1" stop-color="#ff6500"/></linearGradient>
<linearGradient id="clock" gradientUnits="userSpaceOnUse" x1="810" y1="230" x2="530" y2="650"><stop offset="0" stop-color="#ffe600"/><stop offset="0.30" stop-color="#ff9500"/><stop offset="0.65" stop-color="#ff008c"/><stop offset="1" stop-color="#f800bd"/></linearGradient>
<linearGradient id="kkl" gradientUnits="userSpaceOnUse" x1="930" y1="100" x2="1960" y2="600"><stop offset="0" stop-color="#ffe600"/><stop offset="0.28" stop-color="#ffd700"/><stop offset="0.44" stop-color="#00dfd5"/><stop offset="0.62" stop-color="#00b9fa"/><stop offset="0.80" stop-color="#8722ff"/><stop offset="1" stop-color="#eb00d5"/></linearGradient>
<linearGradient id="hands" gradientUnits="userSpaceOnUse" x1="650" y1="310" x2="740" y2="490"><stop offset="0" stop-color="#00f4ef"/><stop offset="1" stop-color="#009bfa"/></linearGradient>
<linearGradient id="hub" gradientUnits="userSpaceOnUse" x1="660" y1="425" x2="690" y2="505"><stop offset="0" stop-color="#fff03a"/><stop offset="1" stop-color="#ff9b00"/></linearGradient>
</defs>'''
    clean=svg_start(width,height,'Simplified vector artwork with smooth cubic paths, gradients and major gloss highlights. Fine paint texture is removed.')
    clean.append(defs)
    clean.append(f'<path fill="#08061f" fill-rule="evenodd" d="{outline_path}"/>')
    for component in components:
        left,top,right,bottom=component['bounds']
        area=component['area']
        if area>300000: fill='url(#kkl)'
        elif area>140000: fill='url(#t)'
        elif area>50000: fill='url(#clock)'
        elif 500<left<850 and 250<top<430: fill='url(#hands)'
        elif 600<left<730 and 400<top<510: fill='url(#hub)'
        else: fill='#%02x%02x%02x'%tuple(component['median'])
        component['fill']=fill
        clean.append(f'<path fill="{fill}" fill-rule="evenodd" d="{component["path"]}"/>')
    highlights=(image[:,:,:3].min(axis=2)>215)&colored
    highlights=ndimage.binary_closing(highlights,iterations=2)
    highlights=remove_small(highlights,140)
    highlights=ndimage.gaussian_filter(highlights.astype(float),2.4)>.5
    highlight_path,_=curve_path(highlights,1.0)
    clean.append(f'<path fill="#ffffff" fill-rule="evenodd" d="{highlight_path}"/>')
    clean.append('</svg>')
    (PACK/'svg/tokkl-wordmark-clean.svg').write_text('\n'.join(clean)+'\n')
    for name,color in [('dark','#000000'),('white','#ffffff')]:
        mono=svg_start(width,height,'Single-ink vector artwork with open clock counter and separate clock hands. Fine paint texture and gloss are removed.')
        for component in components:
            mono.append(f'<path fill="{color}" fill-rule="evenodd" d="{component["path"]}"/>')
        mono.append('</svg>')
        (PACK/f'svg/tokkl-wordmark-mono-{name}.svg').write_text('\n'.join(mono)+'\n')
    metadata=[{key:value for key,value in component.items() if key!='path'} for component in components]
    (PACK/'source/clean-components.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print(json.dumps({'components':len(components),'vertices':sum(c['vertices'] for c in components),'files':['clean','mono-dark','mono-white']},indent=2))


if __name__=='__main__': main()
