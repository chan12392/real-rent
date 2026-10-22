import { useRef, useState } from 'react'
import { ApiError, ask } from '../lib/api'
import type { AskResponse, AskStatus } from '../lib/api'

const EXAMPLES = [
  'L01 관리비에 뭐가 포함돼?',
  'L06 언제 입주할 수 있어?',
  '신길동 매물 관리비 얼마야?',
]

const STATUS_TEXT: Record<AskStatus, { label: string; mark: string; help: string }> = {
  answered: { label: '답변 있음', mark: '✓', help: '문서에서 근거를 찾았습니다.' },
  unknown: { label: '문서에 값 없음', mark: '?', help: '해당 항목이 문서에 없어 추측하지 않았습니다.' },
  clarify: { label: '매물 선택 필요', mark: '↔', help: '어느 매물인지 골라 주세요.' },
  out_of_scope: { label: '범위 밖 질문', mark: '–', help: '이 서비스의 문서에 없는 주제입니다.' },
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading'; question: string }
  | { kind: 'done'; question: string; data: AskResponse }
  | { kind: 'error'; question: string; message: string }

type Props = {
  focusId: string | null
  onClearFocus: () => void
}

export function AskPanel({ focusId, onClearFocus }: Props) {
  const inputId = 'ask-input'
  const [text, setText] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })
  const seq = useRef(0)

  async function send(question: string, listingId: string | null) {
    const q = question.trim()
    if (!q) return
    const mine = ++seq.current
    setState({ kind: 'loading', question: q })
    try {
      const data = await ask(q, listingId)
      if (mine === seq.current) setState({ kind: 'done', question: q, data })
    } catch (error) {
      if (mine !== seq.current) return
      const message =
        error instanceof ApiError
          ? [error.message, ...(error.detail ?? [])].join(' ')
          : '질문을 처리하지 못했습니다.'
      setState({ kind: 'error', question: q, message })
    }
  }

  const busy = state.kind === 'loading'

  return (
    <section id="ask" className="panel ask" aria-labelledby="ask-title">
      <p className="step">4 · 근거 확인</p>
      <h2 id="ask-title">근거 질문</h2>
      <p className="badge-soft">LLM 미사용 · 문서 검색 규칙 답변</p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void send(text, focusId)
        }}
      >
        <label htmlFor={inputId}>매물에 대해 궁금한 점을 물어보세요</label>
        <div className="ask-row">
          <input
            id={inputId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="예: L03 관리비 얼마야?"
            autoComplete="off"
          />
          <button className="primary small" type="submit" disabled={busy || !text.trim()}>
            질문하기
          </button>
        </div>
      </form>

      {focusId && (
        <p className="focus-note">
          <span>
            <b>{focusId}</b> 매물 기준으로 묻는 중
          </span>
          <button type="button" className="ghost" onClick={onClearFocus}>
            해제
          </button>
        </p>
      )}

      <ul className="chips" aria-label="예시 질문">
        {EXAMPLES.map((q) => (
          <li key={q}>
            <button
              type="button"
              className="chip-btn"
              disabled={busy}
              onClick={() => {
                setText(q)
                void send(q, null)
              }}
            >
              {q}
            </button>
          </li>
        ))}
      </ul>

      <div className="answer" aria-live="polite" aria-busy={busy}>
        {state.kind === 'loading' && <p className="loading">“{state.question}” 근거를 찾는 중…</p>}
        {state.kind === 'error' && (
          <div className="alert" role="alert">
            <b>답변을 받지 못했습니다.</b> {state.message}
            <button type="button" className="ghost" onClick={() => void send(state.question, focusId)}>
              다시 시도
            </button>
          </div>
        )}
        {state.kind === 'done' && (
          <article className={`reply reply-${state.data.status}`}>
            <p className="q">Q. {state.question}</p>
            <p className="state">
              <span className="chip chip-ask">
                <span aria-hidden="true">{STATUS_TEXT[state.data.status]?.mark}</span>
                {STATUS_TEXT[state.data.status]?.label ?? state.data.status}
              </span>
              <small>{STATUS_TEXT[state.data.status]?.help}</small>
            </p>
            <p className="a">{state.data.answer}</p>
            {state.data.status === 'clarify' && state.data.candidates.length > 0 && (
              <div className="candidates">
                <span>어느 매물인가요?</span>
                {state.data.candidates.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="chip-btn"
                    onClick={() => void send(state.question, id)}
                  >
                    {id}
                  </button>
                ))}
              </div>
            )}
            {state.data.citations.length > 0 ? (
              <div className="citations">
                <h3>인용 근거</h3>
                <ul>
                  {state.data.citations.map((c, i) => (
                    <li key={`${c.doc_id}-${i}`}>
                      <span className="doc">{c.doc_id}</span>
                      <q>{c.quote}</q>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="hint">인용할 근거 문장이 없습니다.</p>
            )}
          </article>
        )}
        {state.kind === 'idle' && <p className="hint">예시 질문을 눌러 근거와 함께 답을 확인해 보세요.</p>}
      </div>
    </section>
  )
}
