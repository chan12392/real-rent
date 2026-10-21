import { useEffect, useRef, useState } from 'react'
import { compareListings, getCatalog } from './api'
import { ComparisonResults } from './ComparisonResults'
import { ConditionsForm } from './ConditionsForm'
import type { Catalog, Comparison, Conditions } from './types'

export function ComparisonPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [result, setResult] = useState<Comparison | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const requestId = useRef(0)

  useEffect(() => {
    let active = true
    getCatalog().then((data) => {
      if (active) setCatalog(data)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '시연 자료를 읽지 못했습니다.')
    })
    return () => { active = false; requestId.current += 1 }
  }, [reload])

  function changeConditions() {
    requestId.current += 1
    setResult(null)
    setError('')
  }

  async function compare(conditions: Conditions) {
    const id = ++requestId.current
    setBusy(true)
    setResult(null)
    setError('')
    try {
      const next = await compareListings(conditions)
      if (id === requestId.current) setResult(next)
    } catch (reason) {
      if (id === requestId.current) setError(reason instanceof Error ? reason.message : '비교에 실패했습니다.')
    } finally {
      if (id === requestId.current) setBusy(false)
    }
  }

  return (
    <>
      {error && <div className="error-message" role="alert">
        <p>{error}</p>
        {!catalog && <button type="button" className="secondary" onClick={() => {
          setError(''); setReload((value) => value + 1)
        }}>시연 자료 다시 불러오기</button>}
        {catalog && <p>입력한 조건은 유지됩니다. 비교 버튼을 눌러 다시 시도할 수 있습니다.</p>}
      </div>}
      {!catalog && !error && <p className="loading" role="status">시연 자료를 불러오고 있습니다…</p>}
      {catalog && <>
        <p className="demo-notice">{catalog.note} 매물 {catalog.listings.length}건으로 연결을 확인합니다.</p>
        <ConditionsForm offices={catalog.offices} busy={busy} onCompare={compare} onChange={changeConditions} />
        {busy && <p className="loading" role="status">서버에서 비용과 통근 조건을 비교하고 있습니다…</p>}
        {result && <ComparisonResults result={result} />}
        {!result && !busy && !error && <p className="empty-hint">조건을 확인하고 비교를 실행하면 여기에 결과가 표시됩니다.</p>}
      </>}
    </>
  )
}
