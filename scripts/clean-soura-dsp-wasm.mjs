import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), 'public/wasm/soura-dsp')
await rm(root, { recursive: true, force: true })
console.log('[soura-dsp] cleaned public/wasm/soura-dsp')
