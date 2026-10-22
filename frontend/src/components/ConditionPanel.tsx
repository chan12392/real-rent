import { useId, useRef, useState } from 'react'
import { digits } from '../lib/conditions'
import type { FormState } from '../lib/conditions'
import { manwon, num } from '../lib/format'

const HEATING_OPTIONS = [
  ['individual_gas', '개별 가스'],
  ['central', '중앙'],
  ['electric', '전기'],
] as const

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

/** 화면 표시용 요일. 형식이 맞지 않거나 없는 날짜면 빈 문자열. */
function weekdayOf(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return ''
  return WEEKDAYS[date.getDay()]
}

/** 숨긴 날짜 칸의 달력을 연다. 지원하지 않는 브라우저에서는 글자 칸 입력만 쓴다. */
function openPicker(el: HTMLInputElement | null) {
  if (!el) return
  try {
    el.showPicker()
  } catch {
    el.focus()
  }
}

type MoneyProps = { label: string; value: string; onChange: (v: string) => void }

function MoneyField({ label, value, onChange }: MoneyProps) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-unit">
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={value === '' ? '' : num(Number(value))}
          onChange={(e) => onChange(digits(e.target.value))}
          aria-describedby={`${id}-hint`}
        />
        <span aria-hidden="true">원</span>
      </div>
      <p className="hint" id={`${id}-hint`}>
        {value === '' ? '금액을 입력해 주세요' : `= ${manwon(Number(value))}`}
      </p>
    </div>
  )
}

type NumberProps = { label: string; unit: string; value: string; onChange: (v: string) => void }

function NumberField({ label, unit, value, onChange }: NumberProps) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-unit">
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(digits(e.target.value))}
        />
        <span aria-hidden="true">{unit}</span>
      </div>
    </div>
  )
}

type Props = {
  busy: boolean
  /** 폼 값은 App 이 갖는다. 대화에서 확인된 조건도 이 값으로 들어온다. */
  form: FormState
  onFormChange: (f: FormState) => void
  onSubmit: (f: FormState) => string[] | null
}

export function ConditionPanel({ busy, form, onFormChange, onSubmit }: Props) {
  const [errors, setErrors] = useState<string[]>([])
  const dateId = useId()
  const pickerRef = useRef<HTMLInputElement>(null)
  const dow = weekdayOf(form.moveIn)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => onFormChange({ ...form, [k]: v })

  return (
    <form
      className="panel conditions"
      aria-labelledby="cond-title"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        setErrors(onSubmit(form) ?? [])
      }}
    >
      <p className="step">1 · 조건 입력</p>
      <h2 id="cond-title">내 조건</h2>

      <MoneyField label="보증금 한도" value={form.deposit} onChange={(v) => set('deposit', v)} />
      <MoneyField label="월 예산" value={form.budget} onChange={(v) => set('budget', v)} />

      <div className="field">
        <label htmlFor={dateId}>입주 희망일</label>
        {/*
          Windows 의 날짜 형식이 "yyyy-MM-dd'('ddd')'" 이면 Chromium 의 type=date 칸은 요일을 그리지 못해
          "2026-11-01()" 처럼 빈 괄호를 보여 준다. 보이는 칸은 YYYY-MM-DD 글자 칸으로 두고,
          달력은 숨긴 날짜 칸의 선택기(showPicker)로 연다. 두 칸 모두 같은 moveIn 값을 쓴다.
        */}
        <div className="date-field">
          <input
            id={dateId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="YYYY-MM-DD"
            maxLength={10}
            value={form.moveIn}
            onChange={(e) => set('moveIn', e.target.value)}
            aria-describedby={`${dateId}-hint`}
          />
          {dow && (
            <span className="date-dow" aria-hidden="true">
              ({dow})
            </span>
          )}
          <button
            type="button"
            className="date-pick"
            aria-label="달력에서 입주 희망일 고르기"
            onClick={() => openPicker(pickerRef.current)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3.5" y="5" width="17" height="15" rx="3" />
              <path d="M3.5 10h17M8 3v4M16 3v4" />
            </svg>
          </button>
          <input
            ref={pickerRef}
            className="date-native"
            type="date"
            tabIndex={-1}
            aria-hidden="true"
            value={form.moveIn}
            onChange={(e) => set('moveIn', e.target.value)}
          />
        </div>
        <p className="hint" id={`${dateId}-hint`}>
          이 날짜까지 입주할 수 있는 매물만 통과해요. (예: 2026-11-01)
        </p>
      </div>

      <div className="field-row">
        <NumberField label="월 출근일" unit="일" value={form.officeDays} onChange={(v) => set('officeDays', v)} />
        <NumberField label="거주 기간" unit="개월" value={form.stayMonths} onChange={(v) => set('stayMonths', v)} />
        <NumberField label="편도 최대 시간" unit="분" value={form.maxMinutes} onChange={(v) => set('maxMinutes', v)} />
        <NumberField label="최대 환승" unit="회" value={form.maxTransfers} onChange={(v) => set('maxTransfers', v)} />
      </div>

      <fieldset className="field priority">
        <legend>우선순위</legend>
        <label className={form.priority === 'cost' ? 'seg on' : 'seg'}>
          <input
            type="radio"
            name="priority"
            checked={form.priority === 'cost'}
            onChange={() => set('priority', 'cost')}
          />
          <span>비용 먼저</span>
        </label>
        <label className={form.priority === 'time' ? 'seg on' : 'seg'}>
          <input
            type="radio"
            name="priority"
            checked={form.priority === 'time'}
            onChange={() => set('priority', 'time')}
          />
          <span>시간 먼저</span>
        </label>
      </fieldset>

      <details className="living-group">
        <summary>생활 조건 (참고 계산용)</summary>
        <p className="hint">
          “진짜 월 거주비(참고)” 계산에만 쓰여요. 판정·순위는 바뀌지 않아요.
        </p>
        <NumberField label="인원" unit="명 (1~6)" value={form.persons} onChange={(v) => set('persons', v)} />
        <fieldset className="field priority">
          <legend>난방</legend>
          {HEATING_OPTIONS.map(([value, text]) => (
            <label key={value} className={form.heating === value ? 'seg on' : 'seg'}>
              <input
                type="radio"
                name="heating"
                checked={form.heating === value}
                onChange={() => set('heating', value)}
              />
              <span>{text}</span>
            </label>
          ))}
        </fieldset>
      </details>

      <div aria-live="polite">
        {errors.length > 0 && (
          <ul className="form-errors">
            {errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>

      <button className="primary" type="submit" disabled={busy}>
        {busy ? '비교하는 중…' : '이 조건으로 비교하기'}
      </button>
    </form>
  )
}
