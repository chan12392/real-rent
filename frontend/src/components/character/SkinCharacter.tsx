import type { JSX } from 'react'
import { Character as Renti, type CharacterProps } from './Character'
import { mascotSkinRequested } from '../../lib/persona'
import { MascotCharacter } from './MascotCharacter'

/** 기본은 보금이 스킨. URL 쿼리 ?skin=renti 면 렌티. 판별은 persona.ts 한 곳에서 한다. */
export function Character(props: CharacterProps): JSX.Element {
  return mascotSkinRequested() ? <MascotCharacter {...props} /> : <Renti {...props} />
}
