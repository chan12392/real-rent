import { useCallback, useState, type ReactNode } from 'react'
import { skinFallback, type Skin } from '../../lib/skin'
import { SkinContext } from '../../lib/skin-context'

export function SkinProvider({ initialSkin, children }: { initialSkin: Skin; children: ReactNode }) {
  const [skin, setSkin] = useState(initialSkin)
  const failSkin = useCallback((reason: string) => {
    setSkin((current) => current.folder ? skinFallback(current.persona.id === 'local', reason) : current)
  }, [])
  return <SkinContext.Provider value={{ skin, failSkin }}>{children}</SkinContext.Provider>
}
