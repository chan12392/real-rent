import type { JSX } from 'react'
import { Character as Renti, type CharacterProps } from './Character'
import { MascotCharacter } from './MascotCharacter'
import { useSkin } from '../../lib/skin-context'

/** JSON·이미지 검증 결과를 대화와 공유한다. 이후 이미지 실패도 전체 스킨을 렌티로 전환한다. */
export function Character(props: CharacterProps): JSX.Element {
  const { skin, failSkin } = useSkin()
  return (
    <div className="skin-character">
      {skin.folder ? (
        <MascotCharacter {...props} key={skin.folder} skinDir={skin.folder} name={skin.persona.name}
          credit={skin.persona.credit} onSkinError={failSkin} />
      ) : <Renti {...props} />}
      {skin.notice && <small className="skin-notice" role="status">{skin.notice}</small>}
    </div>
  )
}
