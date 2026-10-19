// Uses librsvg via sharp to preserve SVG gradients and clipping.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require(process.env.TOKKL_SHARP_MODULE || 'sharp');
const pack = path.resolve(process.env.TOKKL_PACK_DIR || 'outputs/tokkl-wordmark-pack');
(async () => {
  await fs.mkdir(path.join(pack, 'png'), { recursive: true });
  const sources = (await fs.readdir(path.join(pack, 'svg'))).filter(name => name.endsWith('.svg'));
  for (const source of sources) {
    for (const width of [640, 1280, 2560]) {
      const target = path.join(pack, 'png', `${path.basename(source, '.svg')}-${width}.png`);
      await sharp(path.join(pack, 'svg', source), { density: 150 }).resize(width).png().toFile(target);
      console.log(path.basename(target));
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
