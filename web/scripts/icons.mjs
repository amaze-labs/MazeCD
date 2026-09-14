// Renders every icon the manifest and index.html declare from the one SVG in
// public/favicon.svg. Run with `npm run icons` after changing the mark.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const pub = path.resolve(fileURLToPath(new URL('../public', import.meta.url)))
const src = path.join(pub, 'favicon.svg')
const INK = { r: 0, g: 0, b: 0, alpha: 1 }

const render = (size) => sharp(src).resize(size, size)
const write = (img, name) => img.png().toFile(path.join(pub, name))

// The tab fallback keeps its transparent corners: the rounded tile reads
// better than a square against whatever chrome the browser puts behind it.
await write(render(96), 'favicon-96.png')

// iOS never composites transparency — it pastes the icon onto black — so
// everything that can land on a home screen is flattened onto the ink.
for (const [size, name] of [
  [180, 'apple-touch-icon.png'],
  [192, 'icon-192.png'],
  [512, 'icon-512.png'],
]) {
  await write(render(size).flatten({ background: INK }), name)
}

// Android crops a maskable icon to roughly the central 80% circle — a radius
// of 204.8px. The mark already sits within 171px of the centre, so it survives
// that crop at full size and needs no inset; all the maskable variant does is
// let the ink run to the square's edges instead of stopping at the rounded
// corners.
await write(render(512).flatten({ background: INK }), 'icon-512-maskable.png')

console.log('icons written to public/')
