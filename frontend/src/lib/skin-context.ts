import { createContext, useContext } from 'react'
import { BOGEUM } from './persona'
import type { Skin } from './skin'

export const SkinContext = createContext({
  skin: { persona: BOGEUM, folder: '/skins/bogeum' } as Skin,
  failSkin: (_reason: string) => {},
})

export const useSkin = () => useContext(SkinContext)
