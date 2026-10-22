import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadSkin } from './lib/skin.ts'
import { SkinProvider } from './components/character/SkinProvider.tsx'

const root = createRoot(document.getElementById('root')!)

root.render(<p role="status">캐릭터를 불러오는 중…</p>)

async function start() {
  const skin = await loadSkin(window.location.search)
  // ?lab=character 이면 캐릭터 확인 화면(별도 청크), 아니면 기존 앱 그대로
  const View = new URLSearchParams(window.location.search).get('lab') === 'character'
    ? (await import('./components/character/CharacterLab.tsx')).default
    : App
  root.render(
    <StrictMode>
      <SkinProvider initialSkin={skin}>
        <View />
      </SkinProvider>
    </StrictMode>,
  )
}
void start()
