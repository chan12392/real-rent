import { ConnectionStatus } from './components/ConnectionStatus'
import { ComparisonPage } from './features/comparison/ComparisonPage'
import './App.css'

function App() {
  return (
    <main className="shell">
      <header className="intro">
        <span className="brand">REAL RENT</span>
        <p className="eyebrow">로컬 개발 · 합성 데이터</p>
        <h1>살 곳과 출퇴근을 함께 비교하세요.</h1>
        <p className="description">
          예산과 통근 조건을 입력하면 서버가 비용을 계산하고 최대 3개 집을 비교합니다.
          지금은 고정 시연 회사와 가상 매물로 동작하는 개발용 화면입니다.
        </p>
      </header>

      <ConnectionStatus />
      <ComparisonPage />
      <footer>
        자연어 대화·RAG·실제 교통 조회는 아직 연결하지 않았습니다.
        {' '}개발자는 <a href="http://127.0.0.1:8000/docs" target="_blank" rel="noreferrer">API 문서</a>에서 같은 요청을 테스트할 수 있습니다.
      </footer>
    </main>
  )
}

export default App
