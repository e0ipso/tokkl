#!/usr/bin/env python3
"""Trace a transparent raster into self-contained SVG paths.

Uses palette quantization and subpixel contours. No raster is embedded.
Dependencies already installed on this host: Pillow, NumPy, SciPy, Matplotlib.
"""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage


def simplify(points: np.ndarray, tolerance: float) -> np.ndarray:
    """Iterative Ramer-Douglas-Peucker, with the closed contour split in two."""
    if len(points) < 5 or tolerance <= 0:
        return points
    if np.allclose(points[0], points[-1]):
        pivot = int(np.argmax(np.sum((points - points[0]) ** 2, axis=1)))
        return np.vstack((simplify(points[:pivot + 1], tolerance)[:-1],
                          simplify(points[pivot:], tolerance)))
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        start, end = points[first], points[last]
        segment = end - start
        length_sq = np.dot(segment, segment)
        interior = points[first + 1:last]
        if length_sq == 0:
            distances = np.sum((interior - start) ** 2, axis=1)
        else:
            t = np.clip(((interior - start) @ segment) / length_sq, 0, 1)
            distances = np.sum((interior - (start + t[:, None] * segment)) ** 2, axis=1)
        index = int(np.argmax(distances))
        if distances[index] > tolerance * tolerance:
            index += first + 1
            keep.add(index)
            stack.extend(((first, index), (index, last)))
    return points[sorted(keep)]


def remove_small(mask: np.ndarray, min_area: int) -> np.ndarray:
    if min_area <= 1:
        return mask
    labels, count = ndimage.label(mask)
    areas = np.bincount(labels.ravel())
    keep = areas >= min_area
    keep[0] = False
    return keep[labels]


def contour_path(mask: np.ndarray, tolerance: float = .35) -> tuple[str, int]:
    if not mask.any():
        return '', 0
    padded = np.pad(mask.astype(float), 1)
    figure, axes = plt.subplots(figsize=(1, 1))
    contours = axes.contour(padded, levels=[.5])
    commands = []
    count = 0
    for ring in contours.allsegs[0]:
        if len(ring) < 4:
            continue
        ring = simplify(ring - 1, tolerance)
        if np.allclose(ring[0], ring[-1]):
            ring = ring[:-1]
        if len(ring) < 3:
            continue
        commands.append('M' + 'L'.join(f'{x:.2f},{y:.2f}' for x, y in ring) + 'Z')
        count += len(ring)
    plt.close(figure)
    return ''.join(commands), count


def trace(source: Path, destination: Path, colors: int, blur: float,
          tolerance: float, min_area: int, monochrome: str | None,
          brightness_cutoff: int | None) -> dict:
    original = Image.open(source).convert('RGBA')
    rgba = np.array(original)
    mask = rgba[:, :, 3] >= 128
    if brightness_cutoff is not None:
        mask &= rgba[:, :, :3].max(axis=2) > brightness_cutoff
    mask = remove_small(mask, min_area)
    width, height = original.size
    outline, vertices = contour_path(mask, tolerance)
    title = 'Tokkl wordmark with clock O'
    contents = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-24 -24 {width + 48} {height + 48}" width="{width + 48}" height="{height + 48}" role="img" aria-labelledby="title">',
                f'<title id="title">{title}</title>',
                '<desc>Editable path artwork. The letter o is a clock. No fonts, external assets, or embedded raster images.</desc>']
    path_count = 1
    if monochrome:
        contents.append(f'<path fill="{html.escape(monochrome, quote=True)}" fill-rule="evenodd" d="{outline}"/>')
    else:
        contents.extend([f'<defs><clipPath id="artwork"><path fill-rule="evenodd" clip-rule="evenodd" d="{outline}"/></clipPath></defs>',
                         f'<path fill="#08061f" fill-rule="evenodd" d="{outline}"/>',
                         '<g clip-path="url(#artwork)" fill-rule="evenodd" stroke-linejoin="round" stroke-width="0.65">'])
        rgb = original.convert('RGB')
        if blur:
            rgb = rgb.filter(ImageFilter.GaussianBlur(blur))
        # Fill invisible pixels with the outline color so they do not consume the palette.
        pixels = np.array(rgb)
        pixels[~mask] = (8, 6, 31)
        quantized = Image.fromarray(pixels).quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        indices = np.array(quantized)
        palette = np.array(quantized.getpalette(), dtype=np.uint8).reshape(-1, 3)
        areas = np.bincount(indices[mask], minlength=len(palette))
        for index in np.argsort(-areas):
            if not areas[index]:
                continue
            region = (indices == index) & mask
            region = remove_small(region, min_area)
            data, points = contour_path(region, tolerance)
            if not data:
                continue
            color = '#%02x%02x%02x' % tuple(palette[index])
            contents.append(f'<path fill="{color}" stroke="{color}" d="{data}"/>')
            path_count += 1
            vertices += points
        contents.append('</g>')
    contents.append('</svg>')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text('\n'.join(contents) + '\n')
    return {'file': str(destination), 'width': width, 'height': height,
            'paths': path_count, 'vertices': vertices, 'bytes': destination.stat().st_size,
            'colors': 1 if monochrome else colors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--colors', type=int, default=96)
    parser.add_argument('--blur', type=float, default=.45)
    parser.add_argument('--tolerance', type=float, default=.35)
    parser.add_argument('--min-area', type=int, default=2)
    parser.add_argument('--monochrome')
    parser.add_argument('--brightness-cutoff', type=int)
    args = parser.parse_args()
    print(json.dumps(trace(**vars(args)), indent=2))


if __name__ == '__main__':
    main()
