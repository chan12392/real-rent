import { Component, useEffect, useReducer, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react'
import { parseConditions, react as requestReaction } from '../lib/api'
import type { CompareRequest, CompareResponse } from '../lib/api'
import {
  FIELD_LABEL,
  LISTEN_IDLE_MS,
  QUICK_CHIPS,
  changesFor,
  characterLabel,
  chatReducer,
  createInitialState,
  createSettler,
  currentValueOf,
  formatFieldValue,
} from '../lib/chat'
import type { Change } from '../lib/conditions'
import { explainCompare, explainError } from '../lib/explain'
import { casualize } from '../lib/persona'
import { useSkin } from '../lib/skin-context'
import { Character, DEFAULT_INTENSITY } from './character'

/** App 의 비교 실행 결과. stale 은 더 새로운 비교에 밀려 화면에 반영되지 않은 응답이다. */
export type ChatCompareOutcome =
  | { status: 'ok'; data: CompareResponse }
  | { status: 'error'; message: string }
  | { status: 'stale' }
  | { status: 'invalid'; errors: string[] }

type Props = {
  /** 지금 폼의 조건(유효할 때만). 후보의 “현재값” 표시와 서버 해석에 쓴다. */
  current: CompareRequest | undefined
  /** 사용자가 확인한 변경만 넘어온다. */
  onApply: (changes: Change[]) => void
  onCompare: () => Promise<ChatCompareOutcome>
}

const realClock = {
  now: () => Date.now(),
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** 캐릭터가 그리기에 실패해도 대화와 결과는 계속 동작해야 한다. */
class CharacterBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error) {
    console.warn('캐릭터 렌더 실패 — 대화는 계속합니다.', error.message)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export function ChatPanel({ current, onApply, onCompare }: Props) {
  const { skin } = useSkin()
  const [state, dispatch] = useReducer(chatReducer, DEFAULT_INTENSITY, (table) =>
    createInitialState(table, skin.persona),
  )
  const personaRef = useRef(skin.persona)
  useEffect(() => {
    personaRef.current = skin.persona
    dispatch({ type: 'personaChanged', persona: skin.persona })
  }, [skin.persona])
  const { persona } = state
  const casual = persona.tone === 'casual'
  const [draft, setDraft] = useState('')
  const seq = useRef(0)
  const compareSeq = useRef(0)
  const composing = useRef(false)
  const sending = useRef<string | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const logRef = useRef<HTMLOListElement>(null)

  // 입력이 멈추면(1.2초) 듣기 → 대기. 서버 호출 없음.
  function armIdle() {
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => dispatch({ type: 'idleTimeout' }), LISTEN_IDLE_MS)
  }
  useEffect(() => () => clearTimeout(idleTimer.current), [])

  // 반응 표정은 3초 이상 유지한 뒤, 오류 표정은 잠시 뒤 대기로 돌아간다. 결과 표정은 다음 입력까지 유지한다.
  const settler = useRef<ReturnType<typeof createSettler> | undefined>(undefined)
  settler.current ??= createSettler(realClock, dispatch)
  useEffect(() => {
    settler.current?.sync(state)
  }, [state])
  useEffect(() => () => settler.current?.cancel(), [])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.messages.length])

  function onInput(e: ChangeEvent<HTMLInputElement>) {
    setDraft(e.target.value)
    dispatch({ type: 'typing', at: Date.now() })
    armIdle()
  }

  function send(text: string) {
    const message = text.trim()
    if (!message) return
    if (sending.current === message) return // 같은 요청 중복 처리 금지
    sending.current = message
    clearTimeout(idleTimer.current)
    const id = `r-${++seq.current}`
    dispatch({ type: 'submit', requestId: id, text: message })
    setDraft('')

    // 표정과 조건 해석은 서로 독립이다. 어느 쪽이 실패해도 다른 쪽은 계속한다.
    const reaction = requestReaction(id, message, 'input').then(
      (res) => {
        if (res.request_id !== id) dispatch({ type: 'reactFail', requestId: id })
        else dispatch({ type: 'reactOk', requestId: id, expressionId: res.expression_id, confidence: res.confidence, at: Date.now() })
      },
      () => dispatch({ type: 'reactFail', requestId: id }),
    )
    const parsing = parseConditions(message, current).then(
      (response) => dispatch({ type: 'parseOk', requestId: id, response }),
      () => dispatch({ type: 'parseFail', requestId: id }),
    )
    void Promise.all([reaction, parsing]).then(() => {
      if (sending.current === message) sending.current = null
    })
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || e.shiftKey) return
    // 한글 등 IME 조합 중 Enter 는 글자 확정이다. 전송하지 않는다.
    if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return
    e.preventDefault()
    send(draft)
  }

  function resolve(index: number | 'all', decision: 'apply' | 'cancel') {
    if (decision === 'apply') {
      const changes = changesFor(state.pending, index)
      if (changes.length > 0) onApply(changes)
    }
    dispatch({ type: 'resolve', index, decision })
  }

  async function runCompare() {
    const token = ++compareSeq.current
    dispatch({ type: 'compareStart', token })
    let outcome: ChatCompareOutcome
    try {
      outcome = await onCompare()
    } catch {
      outcome = { status: 'error', message: '알 수 없는 오류가 발생했습니다.' }
    }
    if (outcome.status === 'invalid') {
      dispatch({ type: 'compareAbort', token })
      dispatch({ type: 'compareInvalid', errors: outcome.errors })
    } else if (outcome.status === 'stale') {
      dispatch({ type: 'compareAbort', token })
    } else if (outcome.status === 'error') {
      dispatch({ type: 'compareDone', token, kind: 'error', text: explainError(outcome.message, personaRef.current.tone).text })
    } else {
      const { kind, text } = explainCompare(outcome.data, personaRef.current.tone)
      dispatch({ type: 'compareDone', token, kind, text })
    }
  }

  const label = characterLabel(state.characterState, state.expression, persona)
  const pending = state.pending
  const anyPending = pending?.candidates.some((c) => c.status === 'pending') ?? false
  const lastId = state.messages[state.messages.length - 1]?.id

  return (
    <section className={`panel chat chat-${persona.id}`} aria-labelledby="chat-title">
      <p className="step">대화 입력</p>
      <h2 id="chat-title">{persona.panelTitle}</h2>
      <p className="destination-note" role="note">목적지는 시연 회사 A(위치 미지정)로 고정돼 있습니다. 서울역 등 회사·역 이름을 말해도 목적지는 변경되지 않습니다. 시간·환승·예산 조건만 확인 후 반영합니다.</p>

      <div className="chat-body">
        <div className="chat-char">
          <CharacterBoundary fallback={<div className="chat-char-fallback" role="img" aria-label={label} />}>
            <Character
              state={state.characterState}
              expression={state.expression}
              intensity={state.intensity}
              typingPulse={state.typingPulse}
              label={label}
            />
          </CharacterBoundary>
          <p className="chat-char-label" aria-hidden="true">
            {label.replace(/ \(.*\)$/, '')}
          </p>
          <p className="badge-soft">규칙 기반 해석 · LLM 미사용</p>
        </div>

        <div className="chat-main">
          <ol className="chat-log" ref={logRef} role="log" aria-live="polite" aria-label={persona.logLabel}>
            {state.messages.map((m) => (
              <li key={m.id} className={m.role === 'user' ? 'bubble user' : 'bubble lenti'}>
                <span className="who">{m.role === 'user' ? '나' : persona.name}</span>
                <span className="said">{m.text}</span>
                {m.retryText && m.id === lastId && state.inflightText === null && (
                  <button type="button" className="ghost" onClick={() => send(m.retryText ?? '')}>
                    다시 보내기
                  </button>
                )}
              </li>
            ))}
          </ol>
          <p className="hint">대화는 이전 조건의 기록도 포함합니다. 현재 비교 결과는 아래 ‘추천 결과’에서 확인하세요.</p>

          {pending && (
            <div className="cand-card" role="group" aria-label="조건 확인">
              <h3>{casual ? '이렇게 바꿀까?' : '이렇게 바꿀까요?'}</h3>
              <ul>
                {pending.candidates.map((c, i) => (
                  <li key={`${c.field}-${i}`} className={`cand ${c.status}`}>
                    <div className="cand-main">
                      <b>{FIELD_LABEL[c.field] ?? c.field}</b>
                      {c.status === 'pending' && (
                        <>
                          <span className="cand-from">{formatFieldValue(c.field, currentValueOf(current, c.field))}</span>
                          <span aria-hidden="true">→</span>
                          <span className="sr-only">에서</span>
                        </>
                      )}
                      <strong className="cand-to">{formatFieldValue(c.field, c.value)}</strong>
                      {c.needs_confirmation && c.status === 'pending' && <span className="chip chip-unknown">확인 필요</span>}
                      {c.status === 'applied' && <span className="chip chip-pass">반영됨</span>}
                      {c.status === 'cancelled' && <span className="chip chip-fail">취소됨</span>}
                    </div>
                    {c.note && <p className="hint">{casual ? casualize(c.note) : c.note}</p>}
                    {c.source_text && <p className="hint">입력한 말: “{c.source_text}”</p>}
                    {c.status === 'pending' && (
                      <div className="cand-actions">
                        <button type="button" className="primary small" onClick={() => resolve(i, 'apply')}>
                          반영
                        </button>
                        <button type="button" className="ghost" onClick={() => resolve(i, 'cancel')}>
                          취소
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {anyPending && (
                <div className="cand-actions all">
                  <button type="button" className="primary small" onClick={() => resolve('all', 'apply')}>
                    모두 반영
                  </button>
                  <button type="button" className="ghost" onClick={() => resolve('all', 'cancel')}>
                    모두 취소
                  </button>
                </div>
              )}
            </div>
          )}

          {state.appliedCount > 0 && (
            <div className="chat-compare">
              <button type="button" className="primary small" disabled={state.comparing} onClick={() => void runCompare()}>
                {state.comparing ? '비교하는 중…' : '이 조건으로 비교하기'}
              </button>
              <span className="hint">{casual ? '‘내 조건’에 들어 있는 값으로 비교해.' : '‘내 조건’에 들어 있는 값으로 비교해요.'}</span>
            </div>
          )}

          <div className="chat-chips" role="group" aria-label="빠른 입력 예시">
            {QUICK_CHIPS.map((chip) => (
              <button key={chip} type="button" className="chat-chip" onClick={() => send(chip)}>
                {chip}
              </button>
            ))}
          </div>

          <form
            className="chat-form"
            onSubmit={(e) => {
              e.preventDefault()
              send(draft)
            }}
          >
            <label className="sr-only" htmlFor="chat-input">
              {persona.inputLabel}
            </label>
            <input
              id="chat-input"
              type="text"
              autoComplete="off"
              maxLength={500}
              enterKeyHint="send"
              placeholder="예: 월세 60 이하로, 40분 안쪽"
              value={draft}
              onChange={onInput}
              onKeyDown={onKeyDown}
              onCompositionStart={() => {
                composing.current = true
              }}
              onCompositionEnd={() => {
                composing.current = false
              }}
            />
            <button type="submit" className="primary small" disabled={draft.trim() === ''}>
              보내기
            </button>
          </form>
        </div>
      </div>
    </section>
  )
}
