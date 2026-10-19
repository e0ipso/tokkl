#!/usr/bin/env python3
"""Export this pack's SVG subset to vector PDF paths and gradient shadings."""
from pathlib import Path
import os
import re
import xml.etree.ElementTree as ET
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

NS='{http://www.w3.org/2000/svg}'
TOKEN=re.compile(r'[MLCZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?')


def make_path(output,data):
    tokens=TOKEN.findall(data)
    p=output.beginPath()
    index=0
    while index<len(tokens):
        command=tokens[index]; index+=1
        count={'M':2,'L':2,'C':6,'Z':0}[command]
        args=list(map(float,tokens[index:index+count]));index+=count
        if command=='M':p.moveTo(*args)
        elif command=='L':p.lineTo(*args)
        elif command=='C':p.curveTo(*args)
        else:p.close()
    return p


def export(source,destination):
    root=ET.parse(source).getroot()
    x,y,width,height=map(float,root.get('viewBox').split())
    scale=720/width
    destination.parent.mkdir(parents=True,exist_ok=True)
    output=canvas.Canvas(str(destination),pagesize=(720,height*scale),pageCompression=1)
    output.setTitle('Tokkl wordmark with clock O')
    output.setAuthor('Tokkl')
    output.setSubject('Vector wordmark artwork. RGB working colors.')
    output.translate(-x*scale,(height+y)*scale)
    output.scale(scale,-scale)
    definitions={e.get('id'):e for e in root.iter() if e.get('id')}
    def draw(element,inherited):
        local=element.tag.removeprefix(NS)
        if local in ('defs','title','desc'):return
        attrs={**inherited,**element.attrib}
        output.saveState()
        clip=element.get('clip-path')
        if clip:
            definition=definitions[clip[5:-1]]
            path=definition.find(NS+'path')
            output.clipPath(make_path(output,path.get('d')),stroke=0,fill=0,fillMode=0)
        if local=='path':
            path=make_path(output,element.get('d'))
            fill=attrs.get('fill','#000000')
            stroke=attrs.get('stroke','none')
            if fill.startswith('url('):
                gradient=definitions[fill[5:-1]]
                output.clipPath(path,stroke=0,fill=0,fillMode=0)
                coordinates=[float(gradient.get(k)) for k in ('x1','y1','x2','y2')]
                stops=list(gradient)
                colors=[HexColor(stop.get('stop-color')) for stop in stops]
                positions=[float(stop.get('offset')) for stop in stops]
                output.linearGradient(*coordinates,colors,positions,extend=True)
            else:
                if fill=='#000000':output.setFillGray(0)
                elif fill!='none':output.setFillColor(HexColor(fill))
                if stroke!='none':output.setStrokeColor(HexColor(stroke))
                output.setLineWidth(float(attrs.get('stroke-width','1')))
                output.setLineJoin(1 if attrs.get('stroke-linejoin')=='round' else 0)
                output.drawPath(path,fill=int(fill!='none'),stroke=int(stroke!='none'),fillMode=0)
        else:
            for child in element: draw(child,attrs)
        output.restoreState()
    draw(root,{})
    output.showPage();output.save()
    print(destination)


if __name__=='__main__':
    pack=Path(os.environ.get('TOKKL_PACK_DIR', 'outputs/tokkl-wordmark-pack'))
    for source in sorted((pack/'svg').glob('*.svg')):
        export(source,pack/'pdf'/source.with_suffix('.pdf').name)
