// Renders every icon the manifest and index.html declare from the one SVG in
// public/favicon.svg. Run with `npm run icons` after changing the mark.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const pub = path.resolve(fileURLToPath(new URL('../public', import.meta.url)))
const src = path.join(pub, 'favicon.svg')
const INK = { r: 0x0a, g: 0x0f, b: 0x14, alpha: 1 }

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

// Android crops a maskable icon to roughly the central 80% circle, so the
// mark is inset to 78% and the ink is allowed to run to the edges.
await write(
  sharp({ create: { width: 512, height: 512, channels: 4, background: INK } }).composite([
    { input: await render(400).png().toBuffer(), top: 56, left: 56 },
  ]),
  'icon-512-maskable.png',
)

console.log('icons written to public/')
