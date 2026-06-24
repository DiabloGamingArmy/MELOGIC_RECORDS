import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const outDir = resolve(process.cwd(), 'public/wasm/soura-dsp')
const wasmPath = resolve(outDir, 'soura_signalsmith.wasm')
const manifestPath = resolve(outDir, 'soura-dsp-engine.json')
const vendorModulePath = resolve(process.cwd(), 'src/studio/audio/dsp/wasm/vendor/SignalsmithStretch.mjs')

const vendorSource = await readFile(vendorModulePath, 'utf8')
const match = vendorSource.match(/data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)/)

if (!match?.[1]) {
  console.error('[soura-dsp] Could not find embedded Signalsmith WASM payload in vendor module.')
  process.exit(1)
}

const wasm = Buffer.from(match[1], 'base64')
try {
  await WebAssembly.compile(wasm)
} catch (err) {
  console.error(`[soura-dsp] Extracted Signalsmith WASM failed to compile: ${err?.message || err}`)
  process.exit(1)
}

await mkdir(outDir, { recursive: true })
await writeFile(wasmPath, wasm)
await writeFile(manifestPath, `${JSON.stringify({
  engineId: 'soura-wasm-signalsmith-v1',
  engineLabel: 'Soura WASM DSP: Signalsmith Stretch',
  engineType: 'wasm',
  requiresWasm: true,
  version: 'signalsmith-stretch-1.3.2',
  wasm: '/wasm/soura-dsp/soura_signalsmith.wasm',
  vendorModule: 'src/studio/audio/dsp/wasm/vendor/SignalsmithStretch.mjs',
  generatedAt: new Date().toISOString(),
  source: {
    package: 'signalsmith-stretch',
    version: '1.3.2',
    license: 'MIT',
    url: 'https://www.npmjs.com/package/signalsmith-stretch'
  }
}, null, 2)}\n`)

console.log(`[soura-dsp] extracted official Signalsmith WASM to ${wasmPath}`)
