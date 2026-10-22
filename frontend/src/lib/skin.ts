import { BOGEUM, RENTI, personaFromSkinJson, personaIdFromSearch } from './persona.ts'
import type { Persona } from './persona.ts'

export const SKIN_POSES = ['neutral', 'excited', 'thinking', 'worried', 'surprised', 'sorry', 'blink'] as const
export type Skin = { persona: Persona; folder?: string; notice?: string }

export function skinFallback(local: boolean, reason: string): Skin {
  return {
    persona: RENTI,
    ...(local ? { notice: `내 캐릭터를 불러오지 못해 렌티로 보여요: ${reason}` } : {}),
  }
}

async function preloadImage(path: string): Promise<void> {
  const filename = path.split('/').pop()
  let bytes: ArrayBuffer
  try {
    const response = await fetch(path, { signal: AbortSignal.timeout(6000) })
    if (!response.ok) throw new Error()
    bytes = await response.arrayBuffer()
  } catch {
    throw new Error(`${filename}: 이미지가 없거나 불러올 수 없어요 (6초 제한)`)
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8))
  if (!signature.every((byte, i) => byte === header[i])) throw new Error(`${filename}: PNG 파일이어야 해요`)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
  return new Promise((resolve, reject) => {
    const image = new Image()
    const timer = window.setTimeout(() => finish(`${filename}: 불러오기 시간 초과`), 6000)
    function finish(reason?: string) {
      window.clearTimeout(timer)
      image.onload = image.onerror = null
      URL.revokeObjectURL(url)
      if (reason) reject(new Error(reason))
      else resolve()
    }
    image.onload = () => finish(
      image.naturalWidth === image.naturalHeight && image.naturalWidth >= 512
        ? undefined
        : `${filename}: 정사각형 512px 이상이어야 해요`,
    )
    image.onerror = () => finish(`${filename}: 이미지가 없거나 읽을 수 없어요`)
    image.src = url
  })
}

/** 대화가 시작되기 전에 JSON과 모든 표정을 확인해 그림·이름·말투를 함께 결정한다. */
export async function loadSkin(search: string): Promise<Skin> {
  const id = personaIdFromSearch(search)
  if (id === 'renti') return { persona: RENTI }
  const local = id === 'local'
  const folder = `/skins/${id}`
  try {
    let persona = BOGEUM
    if (local) {
      const response = await fetch(`${folder}/skin.json`, { cache: 'no-store', signal: AbortSignal.timeout(6000) })
      if (!response.ok) throw new Error(`skin.json: 불러오기 실패 (${response.status})`)
      let json: unknown
      try {
        json = await response.json()
      } catch {
        throw new Error('skin.json: 파일이 없거나 올바른 JSON이 아니에요')
      }
      persona = personaFromSkinJson(json)
    }
    await Promise.all(SKIN_POSES.map((pose) => preloadImage(`${folder}/${pose}.png`)))
    return { persona, folder }
  } catch (error) {
    const reason = error instanceof Error ? error.message : '파일을 읽을 수 없어요'
    return skinFallback(local, reason)
  }
}
