import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const root = createRoot(document.getElementById('root')!)

// ?lab=character 이면 캐릭터 확인 화면(별도 청크), 아니면 기존 앱 그대로
if (new URLSearchParams(window.location.search).get('lab') === 'character') {
  void import('./components/character/CharacterLab.tsx').then(({ default: CharacterLab }) => {
    root.render(
      <StrictMode>
        <CharacterLab />
      </StrictMode>,
    )
  })
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
