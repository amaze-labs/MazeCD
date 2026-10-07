// Renders every icon the manifest and index.html declare from the one SVG in
// public/favicon.svg. Run with `npm run icons` after changing the mark.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const pub = path.resolve(fileURLToPath(new URL('../public', import.meta.url)))
const src = path.join(pub, 'favicon.svg')
// The tile's own colour, so a flattened corner is indistinguishable from it.
const TILE = '#0c1118'

// The SVG is a 32-unit viewBox with no width/height, which sharp would raster
// at 32px and then upscale into mush. Rasterise it at 512px (72dpi × 16)
// before resizing down.
const render = (size) => sharp(src, { density: 72 * 16 }).resize(size, size)
const write = (img, name) => img.png().toFile(path.join(pub, name))

// The tab fallback keeps its transparent corners: the rounded tile reads
// better than a square against whatever chrome the browser puts behind it.
await write(render(96), 'favicon-96.png')

// iOS never composites transparency — it pastes the icon onto black — so
// everything that can land on a home screen is flattened onto the tile colour,
// which squares the rounded corners off instead of leaving them transparent.
for (const [size, name] of [
  [180, 'apple-touch-icon.png'],
  [192, 'icon-192.png'],
  [512, 'icon-512.png'],
]) {
  await write(render(size).flatten({ background: TILE }), name)
}

// Android crops a maskable icon to roughly the central 80% circle — a radius
// of 204.8px at 512. The tile's own margin keeps the mark within ~200px of the
// centre (the outer edge of its rounded corners is the farthest point), so it
// survives that crop at full size and needs no inset. Flattening onto the tile
// colour makes the square full-bleed: the crop never shows a corner.
await write(render(512).flatten({ background: TILE }), 'icon-512-maskable.png')

console.log('icons written to public/')
