import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const originalSource = path.join(root, 'source/master-transparent.png');
const source = path.join(root, 'source/master-export.png');
const outlineSvgPath = path.join(root, 'source/clock-outline.svg');
const require = createRequire(import.meta.url);
const sharp = require(process.env.TOKKL_SHARP_PATH || 'sharp');
const background = '#291329';
const temporary = await mkdtemp(path.join(tmpdir(), 'tokkl-icons-'));
const records = [];
const magick = async (...args) => (await execute('magick', args, {
  encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 120000,
})).stdout;
const target = (relative) => path.join(root, relative);
const write = async (relative, content) => {
  await mkdir(path.dirname(target(relative)), { recursive: true });
  await writeFile(target(relative), content);
};
const pngSettings = ['-strip', '-colorspace', 'sRGB', '-define', 'png:color-type=6'];

// ImageMagick strips the sRGB chunk along with other metadata. Add the standard
// PNG sRGB chunk explicitly after encoding so viewers do not have to guess.
async function embedSrgb(file) {
  const buffer = await readFile(file);
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error(`Expected PNG: ${file}`);
  }
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'sRGB') return;
    offset += length + 12;
  }
  const chunk = Buffer.alloc(13);
  chunk.writeUInt32BE(1, 0);
  chunk.write('sRGB', 4, 'ascii');
  chunk[8] = 0; // Perceptual rendering intent.
  let crc = 0xFFFFFFFF;
  for (const byte of chunk.subarray(4, 9)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0, 9);
  await writeFile(file, Buffer.concat([buffer.subarray(0, 33), chunk, buffer.subarray(33)]));
}

async function geometry(file) {
  const dimensions = (await magick('identify', '-format', '%w %h', file)).toString().split(' ').map(Number);
  const [width, height] = dimensions;
  const rgba = await magick(file, '-depth', '8', 'rgba:-');
  let left = width, top = height, right = -1, bottom = -1, alphaMin = 255, alphaMax = 0;
  let maxRadius = 0, alphaPixels = 0, nonwhitePixels = 0;
  let visibleLeft = width, visibleTop = height, visibleRight = -1, visibleBottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const alpha = rgba[offset + 3];
      alphaMin = Math.min(alphaMin, alpha);
      alphaMax = Math.max(alphaMax, alpha);
      if (!alpha) continue;
      alphaPixels++;
      if (alpha >= 128) {
        visibleLeft = Math.min(visibleLeft, x); visibleTop = Math.min(visibleTop, y);
        visibleRight = Math.max(visibleRight, x); visibleBottom = Math.max(visibleBottom, y);
      }
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
      maxRadius = Math.max(maxRadius, Math.hypot(Math.abs(x + 0.5 - width / 2) + 0.5,
        Math.abs(y + 0.5 - height / 2) + 0.5));
      if (rgba[offset] !== 255 || rgba[offset + 1] !== 255 || rgba[offset + 2] !== 255) nonwhitePixels++;
    }
  }
  if (!alphaPixels) throw new Error(`Empty artwork: ${file}`);
  const centerX = (left + right + 1) / 2, centerY = (top + bottom + 1) / 2;
  let bboxRadius = 0;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (!rgba[(y * width + x) * 4 + 3]) continue;
      bboxRadius = Math.max(bboxRadius, Math.hypot(Math.abs(x + 0.5 - centerX) + 0.5,
        Math.abs(y + 0.5 - centerY) + 0.5));
    }
  }
  return { width, height, bounds: { left, top, width: right - left + 1, height: bottom - top + 1 },
    visibleBounds: { left: visibleLeft, top: visibleTop, width: visibleRight - visibleLeft + 1, height: visibleBottom - visibleTop + 1 },
    alphaMin, alphaMax, alphaPixels, nonwhitePixels, maxRadius, bboxRadius };
}

await magick(originalSource, '-channel', 'A', '-fx', 'u <= 8/255 ? 0 : u', '+channel',
  ...pngSettings, `PNG32:${source}`);
const master = await geometry(source);
const sourceRgba = await magick(source, '-depth', '8', 'rgba:-');
const bodyCutoffY = 1000;
let mass = 0, momentX = 0, momentY = 0;
for (let y = 0; y < bodyCutoffY; y++) {
  for (let x = 0; x < master.width; x++) {
    const alpha = sourceRgba[(y * master.width + x) * 4 + 3];
    mass += alpha;
    momentX += (x + 0.5) * alpha;
    momentY += (y + 0.5) * alpha;
  }
}
const anchor = { x: momentX / mass, y: momentY / mass, bodyCutoffY };
const outlineSvg = await readFile(outlineSvgPath, 'utf8');
const whiteOutlineSvg = outlineSvg.replaceAll('currentColor', '#ffffff');
const outlineSource = path.join(temporary, 'outline-master.png');
await sharp(Buffer.from(whiteOutlineSvg)).png().toFile(outlineSource);
const outlineRgba = await magick(outlineSource, '-depth', '8', 'rgba:-');
let artworkRadius = 0, artworkExtent = 0;
for (const rgba of [sourceRgba, outlineRgba]) {
  for (let y = 0; y < master.height; y++) {
    for (let x = 0; x < master.width; x++) {
      if (!rgba[(y * master.width + x) * 4 + 3]) continue;
      const dx = Math.abs(x + 0.5 - anchor.x) + 0.5;
      const dy = Math.abs(y + 0.5 - anchor.y) + 0.5;
      artworkRadius = Math.max(artworkRadius, Math.hypot(dx, dy));
      artworkExtent = Math.max(artworkExtent, dx, dy);
    }
  }
}

async function renderAligned(input, size, scale, output, filter) {
  const tx = size / 2 - anchor.x * scale;
  const ty = size / 2 - anchor.y * scale;
  await magick(input, '-background', 'none', '-virtual-pixel', 'transparent', '-filter', filter,
    '-define', `distort:viewport=${size}x${size}+0+0`, '-distort', 'AffineProjection',
    `${scale},0,0,${scale},${tx},${ty}`, '+repage', ...pngSettings, `PNG32:${output}`);
}

async function bodyCenter(file, scale) {
  const rgba = await magick(file, '-depth', '8', 'rgba:-');
  const measured = await geometry(file);
  const cutoff = measured.height / 2 + (bodyCutoffY - anchor.y) * scale;
  let total = 0, weightedX = 0, weightedY = 0;
  for (let y = 0; y < measured.height; y++) {
    if (y + 0.5 >= cutoff) continue;
    for (let x = 0; x < measured.width; x++) {
      const alpha = rgba[(y * measured.width + x) * 4 + 3];
      total += alpha; weightedX += (x + 0.5) * alpha; weightedY += (y + 0.5) * alpha;
    }
  }
  return { x: weightedX / total, y: weightedY / total,
    errorPx: Math.hypot(weightedX / total - measured.width / 2, weightedY / total - measured.height / 2) };
}

async function foreground(size, policy, output) {
  let desiredScale = policy === 'android' ? size * (65.8 / 108) / (2 * artworkRadius)
    : policy === 'maskable' ? size * 0.76 / (2 * artworkRadius)
      : size * 0.84 / (2 * artworkExtent);
  // Very faint source alpha may vanish at export size. Fit the surviving pixels,
  // then verify the final geometry instead of reserving space for invisible noise.
  const limit = policy === 'android' ? size * 32.9 / 108 : policy === 'maskable' ? size * 0.38 : size * 0.84;
  let measured;
  let renderedScale;
  const mono = path.join(temporary, `aligned-mono-${policy}-${size}.png`);
  for (let iteration = 0; iteration < 12; iteration++) {
    const filter = policy === 'android' ? 'Triangle' : 'Lanczos';
    renderedScale = desiredScale;
    await renderAligned(source, size, desiredScale, output, filter);
    await renderAligned(outlineSource, size, desiredScale, mono, filter);
    measured = await geometry(output);
    const monoMeasured = await geometry(mono);
    const actual = policy === 'any' ? 2 * Math.max(...[measured, monoMeasured].flatMap((g) => [
      size / 2 - g.bounds.left, size / 2 - g.bounds.top,
      g.bounds.left + g.bounds.width - size / 2, g.bounds.top + g.bounds.height - size / 2,
    ])) : Math.max(measured.maxRadius, monoMeasured.maxRadius);
    if (actual <= limit && actual >= limit - (policy === 'android' ? 0.5 : 1)) break;
    desiredScale *= (limit - (policy === 'android' ? 0.1 : 0.5)) / actual;
  }
  measured.scale = renderedScale;
  measured.monochromePath = mono;
  measured.bodyCenter = await bodyCenter(output, renderedScale);
  measured.transform = { scaleX: renderedScale, scaleY: renderedScale,
    translateX: size / 2 - anchor.x * renderedScale, translateY: size / 2 - anchor.y * renderedScale };
  if (measured.bounds.left < 1 || measured.bounds.top < 1 || measured.bounds.left + measured.bounds.width >= size
      || measured.bounds.top + measured.bounds.height >= size) throw new Error(`Artwork touches canvas edge: ${output}`);
  return measured;
}

async function opaqueIcon(relative, size, policy = 'any') {
  await mkdir(path.dirname(target(relative)), { recursive: true });
  const layer = path.join(temporary, `${policy}-${size}.png`);
  const measured = await foreground(size, policy, layer);
  if (policy === 'maskable' && measured.maxRadius > size * 0.4) throw new Error(`Maskable artwork exceeds safe circle: ${relative}`);
  await magick(layer, '-background', background, '-alpha', 'remove', '-alpha', 'on',
    ...pngSettings, `PNG32:${target(relative)}`);
  records.push({ file: relative, size, type: policy, foregroundMaxRadiusPx: measured.maxRadius,
    safeRadiusPx: policy === 'maskable' ? size * 0.4 : null, opaque: true,
    scale: measured.scale, transform: measured.transform, bodyCenter: measured.bodyCenter });
}

async function preview() {
  const cell = 240;
  const tiles = [];
  async function masked(input, shape, filename, theme) {
    const base = path.join(temporary, `${filename}-base.png`);
    if (theme) {
      await magick(input, '-fill', theme[0], '-colorize', '100', '-background', theme[1], '-alpha', 'remove',
        '-crop', '288x288+72+72', '+repage', '-resize', `${cell}x${cell}!`, base);
    } else if (filename.startsWith('android')) {
      await magick(input, '-background', background, '-alpha', 'remove', '-crop', '288x288+72+72',
        '+repage', '-resize', `${cell}x${cell}!`, base);
    } else {
      await magick(input, '-resize', `${cell}x${cell}!`, base);
    }
    const mask = path.join(temporary, `${filename}-mask.png`);
    let draw;
    if (shape === 'circle') draw = `circle 119.5,119.5 119.5,0`;
    else if (shape === 'rounded') draw = `roundrectangle 0,0,239,239 48,48`;
    else {
      const points = Array.from({ length: 361 }, (_, i) => {
        const angle = i / 360 * 2 * Math.PI;
        const x = Math.cos(angle), y = Math.sin(angle);
        return `${119.5 + 119.5 * Math.sign(x) * Math.abs(x) ** 0.4},${119.5 + 119.5 * Math.sign(y) * Math.abs(y) ** 0.4}`;
      });
      draw = `polygon ${points.join(' ')}`;
    }
    await magick('-size', `${cell}x${cell}`, 'xc:black', '-fill', 'white', '-draw', draw, mask);
    const output = target(`previews/${filename}.png`);
    await magick(base, mask, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', ...pngSettings, `PNG32:${output}`);
    tiles.push(output);
  }
  await mkdir(target('previews'), { recursive: true });
  const android = target('android/res/mipmap-xxxhdpi/ic_launcher_foreground.png');
  const mono = target('android/res/mipmap-xxxhdpi/ic_launcher_monochrome.png');
  await masked(android, 'circle', 'android-circle');
  await masked(android, 'squircle', 'android-squircle');
  await masked(android, 'rounded', 'android-rounded');
  await masked(mono, 'circle', 'themed-light', ['#263E34', '#D4E8DB']);
  await masked(mono, 'squircle', 'themed-dark', ['#D4E8DB', '#263E34']);
  await masked(target('web/public/icons/maskable-512.png'), 'circle', 'web-maskable-circle');
  await masked(target('web/public/icons/maskable-512.png'), 'rounded', 'web-maskable-rounded');
  await masked(target('web/public/apple-touch-icon.png'), 'rounded', 'ios-touch-rounded');
  const labels = ['Android / circle', 'Android / squircle', 'Android / rounded square', 'Themed outline / light',
    'Themed outline / dark', 'Web maskable / circle', 'Web maskable / rounded', 'iOS web app / rounded'];
  const args = ['-size', '1200x1400', 'xc:#F2EFF2', '-font', 'DejaVu-Sans', '-fill', '#291329',
    '-pointsize', '36', '-annotate', '+38+54', 'Tokkl / clock O icon pack', '-pointsize', '17',
    '-annotate', '+40+88', 'Approximate OS mask previews. Native Android uses the central 72dp of its 108dp layer.'];
  for (let i = 0; i < tiles.length; i++) {
    const x = 30 + (i % 4) * 300, y = 125 + Math.floor(i / 4) * 320;
    args.push(tiles[i], '-geometry', `+${x}+${y}`, '-compose', 'Over', '-composite', '-pointsize', '17',
      '-fill', '#291329', '-annotate', `+${x}+${y + 269}`, labels[i]);
  }
  args.push('-fill', '#ffffff', '-draw', 'roundrectangle 30,770 570,1080 24,24',
    '-fill', '#291329', '-draw', 'roundrectangle 630,770 1170,1080 24,24');
  for (const [name, x, color] of [['black', 180, '#291329'], ['white', 780, '#ffffff']]) {
    const tile = path.join(temporary, `direct-${name}.png`);
    await magick(target(`logo/outline-${name}-512.png`), '-resize', '240x240', tile);
    args.push(tile, '-geometry', `+${x}+780`, '-compose', 'Over', '-composite', '-fill', color,
      '-pointsize', '20', '-annotate', `+${x - 10}+1050`, `${name === 'black' ? 'Black' : 'White'} outline / transparent`);
  }
  args.push('-fill', '#291329', '-pointsize', '23', '-annotate', '+40+1140', 'Browser favicon / actual pixel sizes');
  for (const [i, size] of [16, 32, 48].entries()) {
    args.push(target(`web/public/icons/favicon-${size}.png`), '-geometry', `+${48 + i * 160}+1175`,
      '-compose', 'Over', '-composite', '-pointsize', '16', '-annotate', `+${48 + i * 160}+1250`, `${size} px`);
  }
  args.push('-pointsize', '16', '-annotate', '+40+1320', 'The main clock body is centered. The drip is excluded from the anchor and included in all safe-area checks.',
    '-annotate', '+40+1355', 'Masks and theme colors are illustrative. Transparent black and white outlines are supplied as SVG and PNG.',
    ...pngSettings, `PNG32:${target('previews/contact-sheet.png')}`);
  await magick(...args);
}

try {
  for (const [density, layerSize, legacySize] of [
    ['mdpi', 108, 48], ['hdpi', 162, 72], ['xhdpi', 216, 96], ['xxhdpi', 324, 144], ['xxxhdpi', 432, 192],
  ]) {
    const relative = `android/res/mipmap-${density}/ic_launcher_foreground.png`;
    await mkdir(path.dirname(target(relative)), { recursive: true });
    const measured = await foreground(layerSize, 'android', target(relative));
    const maxRadiusDp = measured.maxRadius * 108 / layerSize;
    if (maxRadiusDp > 33) throw new Error(`Android artwork exceeds the 66dp safe circle: ${relative}`);
    records.push({ file: relative, size: layerSize, type: 'android-foreground', maxRadiusDp,
      safeRadiusDp: 33, alphaMin: measured.alphaMin, alphaMax: measured.alphaMax,
      visibleWidthDp: measured.visibleBounds.width * 108 / layerSize,
      visibleHeightDp: measured.visibleBounds.height * 108 / layerSize,
      scale: measured.scale, transform: measured.transform, bodyCenter: measured.bodyCenter });
    const monochrome = `android/res/mipmap-${density}/ic_launcher_monochrome.png`;
    await magick(measured.monochromePath, '-channel', 'RGB', '-evaluate', 'set', '100%', '+channel',
      ...pngSettings, `PNG32:${target(monochrome)}`);
    const monoGeometry = await geometry(target(monochrome));
    if (monoGeometry.nonwhitePixels) throw new Error(`Monochrome foreground contains colored pixels: ${monochrome}`);
    const monoRadiusDp = monoGeometry.maxRadius * 108 / layerSize;
    if (monoRadiusDp > 33) throw new Error(`Monochrome artwork exceeds safe circle: ${monochrome}`);
    records.push({ file: monochrome, size: layerSize, type: 'android-monochrome', maxRadiusDp: monoRadiusDp,
      safeRadiusDp: 33, whiteOnly: true, alphaPixels: monoGeometry.alphaPixels, style: 'outline',
      scale: measured.scale, transform: measured.transform });
    await opaqueIcon(`android/res/mipmap-${density}/ic_launcher.png`, legacySize);
  }
  await write('android/res/values/ic_launcher_background.xml', '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#291329</color>\n</resources>\n');
  for (const version of [26, 33]) {
    await write(`android/res/mipmap-anydpi-v${version}/ic_launcher.xml`, `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background" />\n    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n${version === 33 ? '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />\n' : ''}</adaptive-icon>\n`);
  }
  await write('android/AndroidManifest.icon-snippet.xml', '<!-- Merge android:icon into your existing <application> element. -->\n<application xmlns:android="http://schemas.android.com/apk/res/android"\n    android:icon="@mipmap/ic_launcher" />\n');
  for (const size of [192, 512, 1024]) {
    await opaqueIcon(`web/public/icons/icon-${size}.png`, size);
    await opaqueIcon(`web/public/icons/maskable-${size}.png`, size, 'maskable');
  }
  for (const size of [120, 152, 167, 180]) await opaqueIcon(`web/public/icons/apple-touch-icon-${size}.png`, size);
  await opaqueIcon('web/public/apple-touch-icon.png', 180);
  for (const size of [16, 32, 48]) await opaqueIcon(`web/public/icons/favicon-${size}.png`, size);
  await magick(...[16, 32, 48].map((size) => target(`web/public/icons/favicon-${size}.png`)), target('web/public/favicon.ico'));
  await opaqueIcon('store/google-play-512.png', 512);
  for (const size of [256, 512, 1024]) {
    const relative = `logo/color-${size}.png`;
    await mkdir(path.dirname(target(relative)), { recursive: true });
    const measured = await foreground(size, 'any', target(relative));
    records.push({ file: relative, size, type: 'logo-color', opaque: false,
      scale: measured.scale, transform: measured.transform, bodyCenter: measured.bodyCenter });
    for (const [name, color] of [['black', '#000000'], ['white', '#ffffff']]) {
      const png = `logo/outline-${name}-${size}.png`;
      await magick(measured.monochromePath, '-fill', color, '-colorize', '100', ...pngSettings, `PNG32:${target(png)}`);
      const content = outlineSvg.replace(/<\?xml[^>]*\?>/g, '').replaceAll('currentColor', color);
      const { translateX, translateY } = measured.transform;
      await write(`logo/outline-${name}-${size}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">\n<g transform="translate(${translateX} ${translateY}) scale(${measured.scale})" color="${color}">\n${content}\n</g>\n</svg>\n`);
      records.push({ file: png, size, type: 'logo-outline', opaque: false, color,
        scale: measured.scale, transform: measured.transform });
    }
  }
  if ((await stat(target('store/google-play-512.png'))).size > 1024 * 1024) throw new Error('Play Store icon exceeds 1MB');
  await write('web/public/manifest.webmanifest', `${JSON.stringify({
    id: '/', name: 'Tokkl', short_name: 'Tokkl', description: 'Time tracking with Tokkl.',
    start_url: '/', scope: '/', display: 'standalone', background_color: background, theme_color: background,
    icons: ['any', 'maskable'].flatMap((purpose) => [192, 512, 1024].map((size) => ({
      src: `/icons/${purpose === 'any' ? 'icon' : 'maskable'}-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose,
    }))),
  }, null, 2)}\n`);
  await write('web/head-snippet.html', '<link rel="manifest" href="/manifest.webmanifest">\n<meta name="theme-color" content="#291329">\n<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">\n<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">\n<link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16.png">\n<link rel="apple-touch-icon" sizes="120x120" href="/icons/apple-touch-icon-120.png">\n<link rel="apple-touch-icon" sizes="152x152" href="/icons/apple-touch-icon-152.png">\n<link rel="apple-touch-icon" sizes="167x167" href="/icons/apple-touch-icon-167.png">\n<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">\n');
  await preview();
  async function labelPngs(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await labelPngs(full);
      else if (entry.name.endsWith('.png') && full !== originalSource) await embedSrgb(full);
    }
  }
  await labelPngs(root);
  for (const record of records.filter((entry) => entry.opaque)) {
    const measured = await geometry(target(record.file));
    if (measured.alphaMin !== 255) throw new Error(`Expected opaque icon: ${record.file}`);
    if (measured.width !== record.size || measured.height !== record.size) throw new Error(`Incorrect icon dimensions: ${record.file}`);
  }
  await write('checks.json', `${JSON.stringify({
    background, originalSource: 'source/master-transparent.png', source: 'source/master-export.png', sourceGeometry: master,
    alphaCleanup: 'Source alpha <= 8/255 becomes 0. Alpha above this threshold and RGB artwork remain unchanged.',
    alphaThreshold: 'Every pixel with alpha > 0; radii include the furthest pixel corner.',
    opticalAnchor: { ...anchor, method: 'Alpha-weighted centroid of main clock body, excluding source rows y >=1000. Pixel centers are x+0.5,y+0.5.',
      artworkRadius, artworkExtent },
    monochromeSource: 'source/clock-outline.svg', monochromeStyle: 'Hollow outline of clock body, hands, pivot and drip',
    android: { layerDp: 108, viewportDp: 72, targetArtworkDiameterDp: 65.8, safeDiameterDp: 66, filter: 'Triangle' },
    colorMetadata: 'Exports include a PNG sRGB chunk with perceptual rendering intent.',
    maskable: { targetArtworkDiameterFraction: 0.76, safeDiameterFraction: 0.8 },
    checksPassed: true, records,
  }, null, 2)}\n`);
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (full !== target('inventory.json')) {
        const contents = await readFile(full);
        files.push({ file: path.relative(root, full), bytes: contents.length,
          sha256: createHash('sha256').update(contents).digest('hex') });
      }
    }
  }
  await walk(root);
  files.sort((a, b) => a.file.localeCompare(b.file));
  await write('inventory.json', `${JSON.stringify(files, null, 2)}\n`);
  console.log(`Built and verified ${records.length} icon exports. Inventory contains ${files.length} files.`);
  console.log(`Maximum Android radius: ${Math.max(...records.filter((r) => r.maxRadiusDp).map((r) => r.maxRadiusDp)).toFixed(3)}dp / 33dp.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
