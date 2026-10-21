import { useState } from 'react'
import { getHealth } from '../lib/api'

export function ConnectionStatus() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('화면과 서버 연결을 확인할 수 있습니다.')
  async function check() {
    setBusy(true)
    try {
      const health = await getHealth()
      setMessage(`${health.service}에 연결되었습니다.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '서버 연결을 확인해 주세요.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="connection-bar" aria-label="서버 연결">
      <p role="status">{message}</p>
      <button className="secondary" type="button" onClick={check} disabled={busy}>
        {busy ? '확인 중…' : '서버 연결 확인'}
      </button>
    </section>
  )
}
