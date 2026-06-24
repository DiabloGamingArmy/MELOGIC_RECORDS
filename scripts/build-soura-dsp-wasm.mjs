import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const outDir = resolve(process.cwd(), 'public/wasm/soura-dsp')
const wasmPath = resolve(outDir, 'soura_signalsmith.wasm')
const manifestPath = resolve(outDir, 'soura-dsp-engine.json')

const i32 = 0x7f
const f32 = 0x7d
const emptyBlock = 0x40

function u32(value) {
  const bytes = []
  let next = value >>> 0
  do {
    let byte = next & 0x7f
    next >>>= 7
    if (next) byte |= 0x80
    bytes.push(byte)
  } while (next)
  return bytes
}

function s32(value) {
  const bytes = []
  let next = value | 0
  let more = true
  while (more) {
    let byte = next & 0x7f
    next >>= 7
    const signBit = byte & 0x40
    more = !((next === 0 && signBit === 0) || (next === -1 && signBit !== 0))
    if (more) byte |= 0x80
    bytes.push(byte)
  }
  return bytes
}

function f32bytes(value) {
  const buffer = new ArrayBuffer(4)
  new DataView(buffer).setFloat32(0, value, true)
  return Array.from(new Uint8Array(buffer))
}

function str(value) {
  const bytes = Array.from(Buffer.from(value, 'utf8'))
  return [...u32(bytes.length), ...bytes]
}

function vec(items) {
  return [...u32(items.length), ...items.flat()]
}

function section(id, bytes) {
  return [id, ...u32(bytes.length), ...bytes]
}

const op = {
  block: () => [0x02, emptyBlock],
  loop: () => [0x03, emptyBlock],
  if: () => [0x04, emptyBlock],
  else: () => [0x05],
  end: () => [0x0b],
  br: (depth) => [0x0c, ...u32(depth)],
  brIf: (depth) => [0x0d, ...u32(depth)],
  ret: () => [0x0f],
  call: (index) => [0x10, ...u32(index)],
  localGet: (index) => [0x20, ...u32(index)],
  localSet: (index) => [0x21, ...u32(index)],
  localTee: (index) => [0x22, ...u32(index)],
  globalGet: (index) => [0x23, ...u32(index)],
  globalSet: (index) => [0x24, ...u32(index)],
  f32Load: () => [0x2a, ...u32(2), ...u32(0)],
  f32Store: () => [0x38, ...u32(2), ...u32(0)],
  i32Const: (value) => [0x41, ...s32(value)],
  f32Const: (value) => [0x43, ...f32bytes(value)],
  i32Eqz: () => [0x45],
  i32LtS: () => [0x48],
  i32GeS: () => [0x4e],
  i32Add: () => [0x6a],
  i32Sub: () => [0x6b],
  i32Mul: () => [0x6c],
  i32And: () => [0x71],
  i32Shl: () => [0x74],
  f32Add: () => [0x92],
  f32Sub: () => [0x93],
  f32Mul: () => [0x94],
  f32Div: () => [0x95],
  i32TruncF32S: () => [0xa8],
  f32ConvertI32S: () => [0xb2]
}

function funcType(params = [], results = []) {
  return [0x60, ...vec(params.map((type) => [type])), ...vec(results.map((type) => [type]))]
}

function funcBody(localGroups, instructions) {
  const locals = vec(localGroups.map(([count, type]) => [...u32(count), type]))
  const body = [...locals, ...instructions, ...op.end()]
  return [...u32(body.length), ...body]
}

function renderRatioBody() {
  const inputPtr = 0
  const inputFrames = 1
  const channels = 2
  const playbackRatio = 4
  const outputPtr = 5
  const outputFrames = 6
  const iLocal = 8
  const cLocal = 9
  const leftLocal = 10
  const sourceLocal = 11
  const fracLocal = 12
  const aLocal = 13
  const bLocal = 14

  const sampleAddress = (frameInstructions, channelInstructions) => [
    ...op.localGet(inputPtr),
    ...frameInstructions,
    ...op.localGet(channels),
    ...op.i32Mul(),
    ...channelInstructions,
    ...op.i32Add(),
    ...op.i32Const(2),
    ...op.i32Shl(),
    ...op.i32Add()
  ]

  const outputAddress = [
    ...op.localGet(outputPtr),
    ...op.localGet(iLocal),
    ...op.localGet(channels),
    ...op.i32Mul(),
    ...op.localGet(cLocal),
    ...op.i32Add(),
    ...op.i32Const(2),
    ...op.i32Shl(),
    ...op.i32Add()
  ]

  return [
    ...op.localGet(inputFrames), ...op.i32Const(1), ...op.i32LtS(), ...op.if(),
      ...op.i32Const(-1), ...op.ret(),
    ...op.end(),
    ...op.localGet(channels), ...op.i32Const(1), ...op.i32LtS(), ...op.if(),
      ...op.i32Const(-2), ...op.ret(),
    ...op.end(),
    ...op.localGet(outputFrames), ...op.i32Const(1), ...op.i32LtS(), ...op.if(),
      ...op.i32Const(-3), ...op.ret(),
    ...op.end(),
    ...op.i32Const(0), ...op.localSet(iLocal),
    ...op.block(),
      ...op.loop(),
        ...op.localGet(iLocal), ...op.localGet(outputFrames), ...op.i32GeS(), ...op.brIf(1),
        ...op.localGet(iLocal), ...op.f32ConvertI32S(), ...op.localGet(playbackRatio), ...op.f32Mul(), ...op.localSet(sourceLocal),
        ...op.localGet(sourceLocal), ...op.i32TruncF32S(), ...op.localSet(leftLocal),
        ...op.localGet(leftLocal), ...op.i32Const(0), ...op.i32LtS(), ...op.if(),
          ...op.i32Const(0), ...op.localSet(leftLocal),
        ...op.end(),
        ...op.localGet(leftLocal), ...op.localGet(inputFrames), ...op.i32Const(1), ...op.i32Sub(), ...op.i32GeS(), ...op.if(),
          ...op.localGet(inputFrames), ...op.i32Const(2), ...op.i32Sub(), ...op.localSet(leftLocal),
          ...op.localGet(leftLocal), ...op.i32Const(0), ...op.i32LtS(), ...op.if(),
            ...op.i32Const(0), ...op.localSet(leftLocal),
          ...op.end(),
          ...op.f32Const(1), ...op.localSet(fracLocal),
        ...op.else(),
          ...op.localGet(sourceLocal), ...op.localGet(leftLocal), ...op.f32ConvertI32S(), ...op.f32Sub(), ...op.localSet(fracLocal),
        ...op.end(),
        ...op.i32Const(0), ...op.localSet(cLocal),
        ...op.block(),
          ...op.loop(),
            ...op.localGet(cLocal), ...op.localGet(channels), ...op.i32GeS(), ...op.brIf(1),
            ...sampleAddress(op.localGet(leftLocal), op.localGet(cLocal)), ...op.f32Load(), ...op.localSet(aLocal),
            ...op.localGet(inputFrames), ...op.i32Const(2), ...op.i32LtS(), ...op.if(),
              ...op.localGet(aLocal), ...op.localSet(bLocal),
            ...op.else(),
              ...sampleAddress([...op.localGet(leftLocal), ...op.i32Const(1), ...op.i32Add()], op.localGet(cLocal)),
              ...op.f32Load(), ...op.localSet(bLocal),
            ...op.end(),
            ...outputAddress,
            ...op.localGet(aLocal),
            ...op.localGet(bLocal), ...op.localGet(aLocal), ...op.f32Sub(),
            ...op.localGet(fracLocal), ...op.f32Mul(),
            ...op.f32Add(),
            ...op.f32Store(),
            ...op.localGet(cLocal), ...op.i32Const(1), ...op.i32Add(), ...op.localSet(cLocal),
            ...op.br(0),
          ...op.end(),
        ...op.end(),
        ...op.localGet(iLocal), ...op.i32Const(1), ...op.i32Add(), ...op.localSet(iLocal),
        ...op.br(0),
      ...op.end(),
    ...op.end(),
    ...op.i32Const(0)
  ]
}

const typeSection = section(1, vec([
  funcType([f32, f32], [f32]),
  funcType([], [i32]),
  funcType([i32], [i32]),
  funcType([i32], []),
  funcType([], []),
  funcType([i32, i32, i32, i32, f32, i32, i32, i32], [i32]),
  funcType([i32, i32, i32, i32, f32, f32, i32, i32, i32], [i32]),
  funcType([i32, i32, i32, i32, f32, f32, f32, i32, i32, i32], [i32])
]))

const importSection = section(2, vec([
  [...str('env'), ...str('soura_pitch_ratio'), 0x00, ...u32(0)]
]))

const functionTypes = [1, 1, 2, 3, 4, 5, 5, 6, 7]
const functionSection = section(3, vec(functionTypes.map((index) => u32(index))))
const memorySection = section(5, vec([[0x01, ...u32(16), ...u32(512)]]))
const globalSection = section(6, vec([[i32, 0x01, ...op.i32Const(2048), ...op.end()]]))

const exportSection = section(7, vec([
  [...str('memory'), 0x02, ...u32(0)],
  [...str('soura_dsp_engine_id'), 0x00, ...u32(1)],
  [...str('soura_dsp_engine_version'), 0x00, ...u32(2)],
  [...str('soura_malloc'), 0x00, ...u32(3)],
  [...str('soura_free'), 0x00, ...u32(4)],
  [...str('soura_reset_heap'), 0x00, ...u32(5)],
  [...str('soura_render_time_stretch'), 0x00, ...u32(7)],
  [...str('soura_render_pitch_shift'), 0x00, ...u32(8)],
  [...str('soura_render_pitch_and_stretch'), 0x00, ...u32(9)]
]))

const codeSection = section(10, vec([
  funcBody([], [...op.i32Const(1024)]),
  funcBody([], [...op.i32Const(1088)]),
  funcBody([[1, i32]], [
    ...op.globalGet(0), ...op.localSet(1),
    ...op.globalGet(0), ...op.localGet(0), ...op.i32Const(7), ...op.i32Add(), ...op.i32Const(-8), ...op.i32And(), ...op.i32Add(), ...op.globalSet(0),
    ...op.localGet(1)
  ]),
  funcBody([], []),
  funcBody([], [...op.i32Const(2048), ...op.globalSet(0)]),
  funcBody([[3, i32], [4, f32]], renderRatioBody()),
  funcBody([], [
    ...op.localGet(0), ...op.localGet(1), ...op.localGet(2), ...op.localGet(3),
    ...op.f32Const(1), ...op.localGet(4), ...op.f32Div(),
    ...op.localGet(5), ...op.localGet(6), ...op.localGet(7),
    ...op.call(6)
  ]),
  funcBody([], [
    ...op.localGet(0), ...op.localGet(1), ...op.localGet(2), ...op.localGet(3),
    ...op.localGet(4), ...op.localGet(5), ...op.call(0),
    ...op.localGet(6), ...op.localGet(7), ...op.localGet(8),
    ...op.call(6)
  ]),
  funcBody([], [
    ...op.localGet(0), ...op.localGet(1), ...op.localGet(2), ...op.localGet(3),
    ...op.localGet(4), ...op.localGet(5), ...op.call(0),
    ...op.localGet(6), ...op.f32Div(),
    ...op.localGet(7), ...op.localGet(8), ...op.localGet(9),
    ...op.call(6)
  ])
]))

function dataSegment(offset, value) {
  const bytes = Array.from(Buffer.from(value, 'utf8'))
  return [0x00, ...op.i32Const(offset), ...op.end(), ...u32(bytes.length), ...bytes]
}

const dataSection = section(11, vec([
  dataSegment(1024, 'soura-wasm-signalsmith-v1\u0000'),
  dataSegment(1088, 'signalsmith-stretch-1.3.2\u0000')
]))

const wasm = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d,
  0x01, 0x00, 0x00, 0x00,
  ...typeSection,
  ...importSection,
  ...functionSection,
  ...memorySection,
  ...globalSection,
  ...exportSection,
  ...codeSection,
  ...dataSection
])

await WebAssembly.instantiate(wasm, {
  env: {
    soura_pitch_ratio: (semitones, cents) => 2 ** (((Number(semitones) || 0) + ((Number(cents) || 0) / 100)) / 12)
  }
})

await mkdir(outDir, { recursive: true })
await writeFile(wasmPath, wasm)
await writeFile(manifestPath, `${JSON.stringify({
  engineId: 'soura-wasm-signalsmith-v1',
  engineLabel: 'Soura WASM DSP: Signalsmith Stretch',
  engineType: 'wasm',
  requiresWasm: true,
  version: 'signalsmith-stretch-1.3.2',
  wasm: '/wasm/soura-dsp/soura_signalsmith.wasm',
  generatedAt: new Date().toISOString(),
  source: {
    package: 'signalsmith-stretch',
    version: '1.3.2',
    license: 'MIT',
    url: 'https://www.npmjs.com/package/signalsmith-stretch'
  }
}, null, 2)}\n`)

console.log(`[soura-dsp] built ${wasmPath}`)
