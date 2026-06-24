import { stat, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const required = [
  'public/wasm/soura-dsp/soura_signalsmith.wasm',
  'public/wasm/soura-dsp/soura-dsp-engine.json'
]

for (const file of required) {
  const abs = resolve(process.cwd(), file)
  let info
  try {
    info = await stat(abs)
  } catch {
    console.error(`[soura-dsp] Missing required WASM DSP asset: ${file}`)
    console.error('[soura-dsp] Run npm run dsp:build before building or deploying.')
    process.exit(1)
  }
  if (!info.isFile() || info.size <= 0) {
    console.error(`[soura-dsp] Required WASM DSP asset is empty or invalid: ${file}`)
    process.exit(1)
  }
}

try {
  const manifest = JSON.parse(await readFile(resolve(process.cwd(), 'public/wasm/soura-dsp/soura-dsp-engine.json'), 'utf8'))
  if (manifest.engineId !== 'soura-wasm-signalsmith-v1' || manifest.engineType !== 'wasm' || manifest.requiresWasm !== true) {
    throw new Error('manifest does not identify the required WASM engine')
  }
} catch (err) {
  console.error(`[soura-dsp] Invalid WASM DSP manifest: ${err?.message || err}`)
  process.exit(1)
}

console.log('[soura-dsp] verified required WASM DSP assets')
