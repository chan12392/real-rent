// Node 24 내장 모듈만 사용한다. CLI와 화면이 같은 skin.json 검증 함수를 쓴다.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { personaFromSkinJson } from '../src/lib/persona.ts'
import { SKIN_POSES } from '../src/lib/skin.ts'

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function paeth(a, b, c) {
  const p = a + b - c
  const da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c)
  return da <= db && da <= dc ? a : db <= dc ? b : c
}

/** 비인터레이스 RGB/RGBA 8bit PNG를 복원한다. 알 수 없는 포맷을 투명 이미지로 간주하지 않는다. */
export function decodePng(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('PNG 시그니처 오류')
  let offset = 8, width, height, channels, transparent
  let ended = false, idatClosed = false
  const idat = []
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('PNG 청크가 잘렸어요')
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.length) throw new Error('PNG 청크 길이 오류')
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, end - 4)
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) {
      throw new Error(`${type}: PNG CRC 오류`)
    }
    if (width === undefined && type !== 'IHDR') throw new Error('IHDR이 첫 청크여야 해요')
    if (idat.length && type !== 'IDAT') idatClosed = true
    if (type === 'IHDR') {
      if (width !== undefined || length !== 13) throw new Error('IHDR 형식 오류')
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (!width || !height) throw new Error('PNG 크기가 0이에요')
      // 잘못된 헤더나 압축 폭탄에 무제한 메모리를 할당하지 않는다.
      if (width * height > 64 * 1024 * 1024) throw new Error('지원 안 함: 64메가픽셀 초과')
      if (data[8] !== 8 || ![2, 6].includes(data[9]) || data[10] || data[11] || data[12]) {
        throw new Error('지원 안 함: 비인터레이스 RGB/RGBA 8bit PNG만 지원해요 (팔레트 제외)')
      }
      channels = data[9] === 6 ? 4 : 3
    } else if (type === 'IDAT') {
      if (idatClosed) throw new Error('IDAT 청크가 연속하지 않아요')
      idat.push(data)
    } else if (type === 'tRNS') {
      if (channels !== 3 || length !== 6 || transparent || idat.length) throw new Error('tRNS 형식·순서 오류')
      transparent = [data.readUInt16BE(0), data.readUInt16BE(2), data.readUInt16BE(4)]
    } else if (type === 'IEND') {
      if (length || !idat.length || end !== bytes.length) throw new Error('IEND 형식·순서 오류')
      ended = true
      break
    } else if (/^[A-Z]/.test(type)) {
      throw new Error(`지원 안 함: ${type} 청크`)
    }
    offset = end
  }
  if (!ended) throw new Error('IEND가 없어요')
  const stride = width * channels
  const expected = (stride + 1) * height
  let raw
  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected })
  } catch {
    throw new Error('IDAT 압축 데이터 오류')
  }
  if (raw.length !== expected) throw new Error('IDAT 픽셀 길이 오류')
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    if (filter > 4) throw new Error(`지원 안 함: PNG 필터 ${filter}`)
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x
      const a = x >= channels ? pixels[i - channels] : 0
      const b = y ? pixels[i - stride] : 0
      const c = y && x >= channels ? pixels[i - stride - channels] : 0
      const prediction = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]
      pixels[i] = (raw[y * (stride + 1) + 1 + x] + prediction) & 255
    }
  }
  const alpha = new Uint8Array(width * height)
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = channels === 4 ? pixels[i * 4 + 3]
      : transparent?.every((value, channel) => value === pixels[i * 3 + channel]) ? 0 : 255
  }
  return { width, height, alpha }
}

function maskIou(a, b) {
  // 크기가 다르면 같은 정규화 좌표에서 최근접 샘플링한다. 같은 크기는 모든 픽셀을 정확히 비교한다.
  const side = Math.max(a.width, b.width)
  let intersection = 0, union = 0
  for (let y = 0; y < side; y++) {
    const ay = Math.floor(y * a.height / side) * a.width
    const by = Math.floor(y * b.height / side) * b.width
    for (let x = 0; x < side; x++) {
      const ma = a.alpha[ay + Math.floor(x * a.width / side)] > 0
      const mb = b.alpha[by + Math.floor(x * b.width / side)] > 0
      if (ma || mb) union++
      if (ma && mb) intersection++
    }
  }
  return union ? intersection / union : 0
}

export function checkSkin(folder, { imagesOnly = false } = {}) {
  const rows = []
  const decoded = new Map()
  for (const pose of SKIN_POSES) {
    const file = `${pose}.png`
    try {
      const png = decodePng(readFileSync(resolve(folder, file)))
      const size = `${png.width}×${png.height}`
      if (png.width !== png.height || png.width < 512) throw new Error(`${size}: 정사각형 512px 이상이어야 해요 (권장 1024×1024)`)
      const corners = [0, png.width - 1, (png.height - 1) * png.width, png.alpha.length - 1].map((i) => png.alpha[i])
      if (corners.some((a) => a !== 0)) throw new Error(`네 모서리 알파가 0이 아니에요 (${corners.join(', ')})`)
      if (!png.alpha.some((a) => a > 0)) throw new Error('이미지 전체가 투명해요')
      decoded.set(pose, png)
      rows.push({ file, size, corners: '0, 0, 0, 0', iou: '—', status: 'PASS', detail: '' })
    } catch (error) {
      rows.push({ file, size: '—', corners: '—', iou: '—', status: 'ERROR', detail: error.code === 'ENOENT' ? '파일이 없어요' : error.message })
    }
  }
  const neutral = decoded.get('neutral')
  if (neutral) for (const row of rows) {
    const png = decoded.get(row.file.replace('.png', ''))
    if (!png) continue
    const iou = maskIou(neutral, png)
    row.iou = iou.toFixed(4)
    if (iou < 0.85) {
      row.status = 'WARN'
      row.detail = 'IoU < 0.85: 실루엣·위치·크기를 맞춰 주세요'
    }
  }
  if (!imagesOnly) {
    try {
      const persona = personaFromSkinJson(JSON.parse(readFileSync(resolve(folder, 'skin.json'), 'utf8')))
      rows.push({ file: 'skin.json', status: 'PASS', detail: `${persona.name} / ${persona.tone}` })
    } catch (error) {
      rows.push({ file: 'skin.json', status: 'ERROR', detail: error.code === 'ENOENT' ? '파일이 없어요' : error instanceof SyntaxError ? 'JSON 문법 오류' : error.message })
    }
  }
  return rows
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log('사용법: npm run skin:check -- [폴더] [--images-only]\n기본 폴더: public/skins/local (frontend에서 실행)')
    return
  }
  const paths = args.filter((arg) => !arg.startsWith('--'))
  if (paths.length > 1 || args.some((arg) => arg.startsWith('--') && arg !== '--images-only')) {
    throw new Error('사용법: node scripts/check-skin.mjs [폴더] [--images-only]')
  }
  const folder = resolve(paths[0] ?? 'public/skins/local')
  const rows = checkSkin(folder, { imagesOnly: args.includes('--images-only') })
  console.log(`스킨 검사: ${folder}`)
  console.table(rows)
  const errors = rows.filter((row) => row.status === 'ERROR').length
  const warnings = rows.filter((row) => row.status === 'WARN').length
  console.log(`오류 ${errors} · 경고 ${warnings}${errors ? ' — 실패' : ' — 통과'}`)
  process.exitCode = errors ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
