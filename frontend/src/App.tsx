import { useState } from 'react'
import { getHealth } from './lib/api'
import './App.css'

type Connection = 'idle' | 'loading' | 'connected' | 'error'

const areas = [
  ['개발 1', '화면 · 발표', '조건 입력·변경 · 주소 확인 · 후보 비교 · 발표 편집·녹화'],
  ['개발 2', '서버 · DB · 배포', '주소·교통 API · 캐시 · 오류 처리 · 배포'],
  ['개발 3', 'AI · RAG · LangGraph', '자연어 조건 추출 · 경로 응답 정리 · 추천 이유'],
  ['분석', '데이터 · 계산 · 검증', '시연 데이터·근거 문서 · 비용 계산·필터·정렬 · 검증 취합'],
]

function App() {
  const [connection, setConnection] = useState<Connection>('idle')
  const [message, setMessage] = useState('서버를 실행한 뒤 연결을 확인해 주세요.')

  async function checkConnection() {
    setConnection('loading')
    setMessage('서버 응답을 기다리고 있습니다.')
    try {
      const health = await getHealth()
      setConnection('connected')
      setMessage(`${health.service}에 연결되었습니다.`)
    } catch (error) {
      setConnection('error')
      setMessage(
        error instanceof Error && error.message.startsWith('서버')
          ? error.message
          : '서버에 연결할 수 없습니다. 실행 상태와 연결 설정을 확인해 주세요.',
      )
    }
  }

  return (
    <main className="shell">
      <header className="intro">
        <span className="brand">REAL RENT</span>
        <p className="eyebrow">팀 개발 시작 화면</p>
        <h1>함께 만들 준비가 되었습니다.</h1>
        <p className="description">
          거주 비용과 조건을 근거로 집을 비교하는 프로젝트입니다.
          지금은 화면과 서버의 연결을 확인하는 초기 구조입니다.
        </p>
      </header>

      <section className="connection-card" aria-labelledby="connection-title">
        <div>
          <p className="eyebrow">첫 번째 연결</p>
          <h2 id="connection-title">화면 ↔ 서버</h2>
          <p className={`status status-${connection}`} role="status" aria-live="polite">
            {message}
          </p>
        </div>
        <button type="button" onClick={checkConnection} disabled={connection === 'loading'}>
          {connection === 'loading' ? '확인 중…' : '서버 연결 확인'}
        </button>
      </section>

      <section className="work-areas" aria-labelledby="areas-title">
        <h2 id="areas-title">담당 영역</h2>
        <ul>
          {areas.map(([role, title, description]) => (
            <li key={role}>
              <span className="role">{role}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </li>
          ))}
        </ul>
      </section>
      <footer>기능 구현과 팀 합의 사항은 저장소의 README와 docs에서 이어갑니다.</footer>
    </main>
  )
}

export default App
