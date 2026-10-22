import { useEffect, useRef, useState } from 'react'
import { Character } from './SkinCharacter'
import {
  CHARACTER_STATES,
  DEFAULT_INTENSITY,
  EXPRESSION_LABELS,
  EXPRESSIONS,
  type CharacterState,
  type ExpressionId,
} from './expressions'

type MotionMode = 'system' | 'reduce' | 'full'

/** 개발 확인용 화면(?lab=character). 실제 대화·추천 데이터와 연결되지 않는다. */
export default function CharacterLab() {
  const [expression, setExpression] = useState<ExpressionId>('neutral')
  const [state, setState] = useState<CharacterState>('idle')
  const [intensityOverride, setIntensityOverride] = useState<number | null>(null)
  const [motion, setMotion] = useState<MotionMode>('system')
  const [pulse, setPulse] = useState(0)
  const burst = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (burst.current !== null) window.clearInterval(burst.current)
    },
    [],
  )

  const intensity = intensityOverride ?? DEFAULT_INTENSITY[expression]
  const reducedMotion = motion === 'system' ? undefined : motion === 'reduce'

  const startBurst = () => {
    if (burst.current !== null) window.clearInterval(burst.current)
    let left = 14
    burst.current = window.setInterval(() => {
      setPulse((n) => n + 1)
      left -= 1
      if (left <= 0 && burst.current !== null) {
        window.clearInterval(burst.current)
        burst.current = null
      }
    }, 65)
  }

  return (
    <main className="char-lab">
      <h1>렌티 캐릭터 확인 화면</h1>
      <p className="char-lab-note">
        개발 확인용 화면입니다. 표정·상태는 직접 고른 값이며 실제 대화 판단이나 추천 결과가 아닙니다.
      </p>
      <div className="char-lab-grid">
        <figure className="char-lab-stage">
          <Character
            state={state}
            expression={expression}
            intensity={intensity}
            typingPulse={pulse}
            reducedMotion={reducedMotion}
          />
          <figcaption>
            {state === 'error' ? EXPRESSION_LABELS.apologetic : EXPRESSION_LABELS[expression]} · 상태 {state}
          </figcaption>
        </figure>

        <div className="char-lab-controls">
          <fieldset>
            <legend>표정</legend>
            <div className="char-lab-exprs">
              {EXPRESSIONS.map((id) => (
                <button key={id} type="button" aria-pressed={id === expression} onClick={() => setExpression(id)}>
                  {id}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>상태와 강도</legend>
            <div className="char-lab-row">
              <label htmlFor="lab-state">state</label>
              <select id="lab-state" value={state} onChange={(e) => setState(e.target.value as CharacterState)}>
                {CHARACTER_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="char-lab-row" style={{ marginTop: 10 }}>
              <label htmlFor="lab-intensity">intensity</label>
              <input
                id="lab-intensity"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={intensity}
                onChange={(e) => setIntensityOverride(Number(e.target.value))}
              />
              <output htmlFor="lab-intensity">{intensity.toFixed(2)}</output>
              <button type="button" onClick={() => setIntensityOverride(null)} disabled={intensityOverride === null}>
                기본값
              </button>
            </div>
          </fieldset>

          <fieldset>
            <legend>reducedMotion</legend>
            <div className="char-lab-row">
              {(
                [
                  ['system', '시스템 설정 따름'],
                  ['reduce', '켜기(모션 줄임)'],
                  ['full', '끄기'],
                ] as const
              ).map(([value, text]) => (
                <label key={value} className="char-lab-radio">
                  <input type="radio" name="lab-motion" value={value} checked={motion === value} onChange={() => setMotion(value)} />
                  {text}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>입력 반응(typingPulse)</legend>
            <div className="char-lab-row">
              <button type="button" onClick={startBurst}>
                연타 입력
              </button>
              <input
                type="text"
                aria-label="타이핑 시험 입력"
                placeholder="여기에 타이핑해 보기"
                onKeyDown={() => setPulse((n) => n + 1)}
              />
            </div>
          </fieldset>

          <pre aria-label="현재 props">
            {JSON.stringify({ state, expression, intensity: Number(intensity.toFixed(2)), typingPulse: pulse, reducedMotion: reducedMotion ?? '(system)' }, null, 1)}
          </pre>
        </div>
      </div>
    </main>
  )
}
