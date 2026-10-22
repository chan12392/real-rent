import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, compare, getListings } from './lib/api'
import type { CompareRequest, CompareResponse, Listing } from './lib/api'
import { AskPanel } from './components/AskPanel'
import { ChatPanel } from './components/ChatPanel'
import type { ChatCompareOutcome } from './components/ChatPanel'
import { ConditionPanel } from './components/ConditionPanel'
import { DEFAULT_FORM, applyChanges, buildRequest } from './lib/conditions'
import type { Change, FormState } from './lib/conditions'
import { MapView } from './components/MapView'
import { Detail, ResultTable } from './components/ResultTable'
import { Counts, TopPicks } from './components/Summary'
import { krw } from './lib/format'
import { useSkin } from './lib/skin-context'
import './App.css'

type Load<T> =
  | { kind: 'loading' }
  | { kind: 'ok'; data: T }
  | { kind: 'error'; message: string; detail: string[] }

function describe(error: unknown): { message: string; detail: string[] } {
  if (error instanceof ApiError) return { message: error.message, detail: error.detail ?? [] }
  return { message: '알 수 없는 오류가 발생했습니다.', detail: [] }
}

const CLOUD =
  'M30 64C12 64 8 44 24 39C20 21 44 12 58 25C64 7 96 6 103 28C121 23 135 41 124 55C130 63 121 68 112 64Z'

/** 상단 배경: 하늘·구름·언덕. 이미지 파일 없이 인라인 SVG로만 그린다. */
function HeaderScene() {
  return (
    <div className="scene" aria-hidden="true">
      <svg className="cloud cloud-1" viewBox="0 0 140 72">
        <path d={CLOUD} />
      </svg>
      <svg className="cloud cloud-2" viewBox="0 0 140 72">
        <path d={CLOUD} />
      </svg>
      <svg className="cloud cloud-3" viewBox="0 0 140 72">
        <path d={CLOUD} />
      </svg>
      <svg className="hills" viewBox="0 0 1200 120" preserveAspectRatio="none">
        <path className="hill-far" d="M0 64C140 18 300 26 430 58C570 8 730 16 870 52C990 24 1100 28 1200 46V120H0Z" />
        <path className="hill-near" d="M0 92C190 58 380 66 570 90C770 60 990 62 1200 86V120H0Z" />
      </svg>
    </div>
  )
}

/** 대화와 같은 폴더의 캐릭터 장식. */
function MascotDeco({ face, className }: { face: string; className: string }) {
  const { skin, failSkin } = useSkin()
  if (!skin.folder) return null
  return (
    <img
      className={className}
      src={`${skin.folder}/${face}.png`}
      alt=""
      aria-hidden="true"
      draggable={false}
      onError={(e) => {
        e.currentTarget.hidden = true
        failSkin(`${face}.png: 이미지를 표시할 수 없어요`)
      }}
    />
  )
}

function App() {
  const [listings, setListings] = useState<Load<Listing[]>>({ kind: 'loading' })
  const [result, setResult] = useState<Load<CompareResponse>>({ kind: 'loading' })
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [askId, setAskId] = useState<string | null>(null)
  const applied = useRef<CompareRequest | null>(null)
  const seq = useRef(0)

  const fetchCompare = useCallback(async (req: CompareRequest): Promise<ChatCompareOutcome> => {
    applied.current = req
    const mine = ++seq.current
    try {
      const data = await compare(req)
      if (mine !== seq.current) return { status: 'stale' }
      setResult({ kind: 'ok', data })
      return { status: 'ok', data }
    } catch (error) {
      if (mine !== seq.current) return { status: 'stale' }
      const shown = describe(error)
      setResult({ kind: 'error', ...shown })
      return { status: 'error', message: shown.message }
    }
  }, [])

  const fetchListings = useCallback(async () => {
    try {
      const data = await getListings()
      setListings({ kind: 'ok', data: data.listings })
    } catch (error) {
      setListings({ kind: 'error', ...describe(error) })
    }
  }, [])

  const run = useCallback(
    (req: CompareRequest) => {
      setResult({ kind: 'loading' })
      return fetchCompare(req)
    },
    [fetchCompare],
  )

  const loadListings = useCallback(() => {
    setListings({ kind: 'loading' })
    return fetchListings()
  }, [fetchListings])

  useEffect(() => {
    // 첫 화면은 기본 조건으로 바로 비교해 보여 준다. (초기 상태가 이미 loading)
    // 서버 요청은 effect 본문이 아니라 다음 마이크로태스크에서 시작해, effect 안에서 동기 setState 가 일어나지 않게 한다.
    const first = buildRequest(DEFAULT_FORM, {})
    if (!Array.isArray(first)) void Promise.resolve(first).then(fetchCompare)
    void Promise.resolve().then(fetchListings)
  }, [fetchCompare, fetchListings])

  function submitForm(form: FormState): string[] | null {
    const req = buildRequest(form, overrides)
    if (Array.isArray(req)) return req
    void run(req)
    return null
  }

  // 대화에서 사용자가 확인한 조건만 폼에 들어온다. 비교는 별도 버튼(chatCompare)으로만 실행한다.
  function applyConfirmed(changes: Change[]) {
    setForm((prev) => applyChanges(prev, changes))
  }

  const chatCompare = useCallback(async (): Promise<ChatCompareOutcome> => {
    const req = buildRequest(form, overrides)
    if (Array.isArray(req)) return { status: 'invalid', errors: req }
    return run(req)
  }, [form, overrides, run])

  const currentRequest = useMemo(() => {
    const req = buildRequest(form, {})
    return Array.isArray(req) ? undefined : req
  }, [form])

  function changeOverride(id: string, value: number | null) {
    const next = { ...overrides }
    if (value === null) delete next[id]
    else next[id] = value
    setOverrides(next)
    const base = applied.current ?? buildRequest(DEFAULT_FORM, {})
    if (Array.isArray(base)) return
    const { management_overrides: _drop, ...rest } = base
    void run(Object.keys(next).length ? { ...rest, management_overrides: next } : rest)
  }

  // 비교가 오류로 끝나 상세·입력 취소 버튼이 사라져도 덮어쓰기를 걷어내고 다시 계산할 수 있게 한다.
  function clearOverridesAndRetry() {
    setOverrides({})
    const base = applied.current ?? buildRequest(DEFAULT_FORM, {})
    if (Array.isArray(base)) return
    const { management_overrides: _drop, ...rest } = base
    void run(rest)
  }

  function goAsk(id: string) {
    setAskId(id)
    document.getElementById('ask')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    document.getElementById('ask-input')?.focus({ preventScroll: true })
  }

  const data = result.kind === 'ok' ? result.data : null
  const listingList = listings.kind === 'ok' ? listings.data : []
  const selected = data?.results.find((r) => r.listing_id === selectedId)
  const busy = result.kind === 'loading'
  const overrideCount = Object.keys(overrides).length
  const { skin } = useSkin()
  const mascot = !!skin.folder

  return (
    <div className="app">
      <a className="skip" href="#main">
        본문 바로가기
      </a>

      <header className={mascot ? 'top top-mascot' : 'top'}>
        <HeaderScene />
        <div className="top-inner">
          <div className="brand-row">
            <span className="brand">
              <i aria-hidden="true" />
              REAL RENT
            </span>
            <span className="synthetic-badge" role="note">
              <b aria-hidden="true">!</b> 합성 시연 데이터 · 실제 매물 아님
            </span>
          </div>
          <div className="hero">
            {mascot && <MascotDeco face="excited" className="hero-mascot" />}
            <div className="hero-bubble">
              <h1>
                월세만이 아니라 관리비·통근비까지 더한
                <br />
                진짜 거주비로 집을 비교하세요
              </h1>
              <p className="lede">
                조건을 넣으면 12개 시연 매물이 통과·탈락·판단 불가로 나뉘고, 순위와 근거가 함께 나옵니다.
              </p>
            </div>
          </div>
        </div>
      </header>

      <main id="main" className="layout">
        <aside className="side">
          <ConditionPanel busy={busy} form={form} onFormChange={setForm} onSubmit={submitForm} />
        </aside>

        <div className="content">
          <ChatPanel current={currentRequest} onApply={applyConfirmed} onCompare={chatCompare} />

          <section className="panel" aria-labelledby="sum-title" aria-busy={busy}>
            <p className="step">2 · 결과 비교</p>
            <h2 id="sum-title">추천 결과</h2>

            <div aria-live="polite">
              {result.kind === 'loading' && (
                <p className="state-box loading" role="status">
                  {mascot ? (
                    <MascotDeco face="thinking" className="state-mascot" />
                  ) : (
                    <span className="spinner" aria-hidden="true" />
                  )}{' '}
                  서버에서 계산하는 중입니다…
                </p>
              )}
              {result.kind === 'error' && (
                <div className="state-box error" role="alert">
                  <b>결과를 불러오지 못했습니다.</b>
                  <p>{result.message}</p>
                  {result.detail.length > 0 && (
                    <ul>
                      {result.detail.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => applied.current && void run(applied.current)}
                  >
                    다시 시도
                  </button>
                  {overrideCount > 0 && (
                    <button type="button" className="ghost" onClick={clearOverridesAndRetry}>
                      직접 입력한 관리비 모두 지우고 다시 시도
                    </button>
                  )}
                </div>
              )}
            </div>

            {data && (
              <>
                {overrideCount > 0 && (
                  <p className="override-note">
                    직접 입력한 관리비 {overrideCount}건 반영 중:{' '}
                    {Object.entries(overrides)
                      .map(([id, v]) => `${id} ${krw(v)}`)
                      .join(', ')}
                  </p>
                )}
                <Counts counts={data.counts} />
                <h3 className="sub-title">추천 TOP 3</h3>
                <TopPicks data={data} selectedId={selectedId} onSelect={setSelectedId} />
              </>
            )}
          </section>

          {data && (
            <>
              <section className="panel" aria-labelledby="table-title">
                <h2 id="table-title">전체 {data.results.length}건 비교</h2>
                <ResultTable rows={data.results} selectedId={selectedId} onSelect={setSelectedId} />
              </section>

              {selected && (
                <Detail
                  key={selected.listing_id}
                  result={selected}
                  listing={listingList.find((l) => l.listing_id === selected.listing_id)}
                  override={overrides[selected.listing_id]}
                  busy={busy}
                  onOverride={changeOverride}
                  onAsk={goAsk}
                  onClose={() => setSelectedId(null)}
                />
              )}
            </>
          )}

          <section className="panel" aria-labelledby="map-title">
            <p className="step">3 · 위치 보기</p>
            <h2 id="map-title">매물 위치</h2>
            {listings.kind === 'loading' && (
              <p className="state-box loading" role="status">
                <span className="spinner" aria-hidden="true" /> 위치 정보를 불러오는 중…
              </p>
            )}
            {listings.kind === 'error' && (
              <div className="state-box error" role="alert">
                <b>매물 위치를 불러오지 못했습니다.</b>
                <p>{listings.message}</p>
                <button type="button" className="ghost" onClick={() => void loadListings()}>
                  다시 시도
                </button>
              </div>
            )}
            {listings.kind === 'ok' && (
              <MapView
                listings={listings.data}
                results={data?.results ?? []}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            )}
          </section>

          <AskPanel focusId={askId} onClearFocus={() => setAskId(null)} />

          {data && (
            <section className="panel assumptions" aria-labelledby="as-title">
              <h2 id="as-title">이 결과의 가정</h2>
              <ul>
                {data.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>

      <footer className="foot">
        REAL RENT 시연 화면 · 모든 매물·가격·좌표·교통 값은 합성 데이터이며, 계산 규칙은 팀 승인 전 시연 가정입니다.
      </footer>
    </div>
  )
}

export default App
