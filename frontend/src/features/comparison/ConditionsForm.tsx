import type { FormEvent } from 'react'
import type { Conditions, Office } from './types'

const numericFields = [
  { name: 'deposit_limit_krw', label: '보증금 한도 (원)', value: 10000000 },
  { name: 'monthly_limit_krw', label: '월 지출 한도 (원)', value: 800000 },
  { name: 'workdays', label: '월 출근일수 (일)', value: 20, max: 31 },
  { name: 'max_commute_minutes', label: '편도 통근시간 상한 (분)', value: 60 },
  { name: 'max_transfers', label: '편도 환승 상한 (회)', value: 2 },
]

type Props = {
  offices: Office[]
  busy: boolean
  onCompare: (conditions: Conditions) => void
  onChange: () => void
}

export function ConditionsForm({ offices, busy, onCompare, onChange }: Props) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    onCompare({
      office_id: String(data.get('office_id')),
      move_in_date: String(data.get('move_in_date')),
      deposit_limit_krw: Number(data.get('deposit_limit_krw')),
      monthly_limit_krw: Number(data.get('monthly_limit_krw')),
      workdays: Number(data.get('workdays')),
      max_commute_minutes: Number(data.get('max_commute_minutes')),
      max_transfers: Number(data.get('max_transfers')),
      priority: data.get('priority') === 'time' ? 'time' : 'cost',
    })
  }
  return (
    <form className="panel conditions" onSubmit={submit} onChange={onChange}>
      <h2>비교할 조건</h2>
      <p className="muted">조건을 확인한 뒤 비교 버튼을 눌러 주세요. 금액은 원 단위입니다.</p>
      <fieldset disabled={busy}>
        <legend className="sr-only">회사와 예산, 통근 조건</legend>
        <div className="form-grid">
          <label>회사 (고정 시연 위치)
            <select name="office_id" defaultValue={offices[0].id}>
              {offices.map((office) => <option key={office.id} value={office.id}>{office.label}</option>)}
            </select>
          </label>
          <label>입주 희망일
            <input type="date" name="move_in_date" defaultValue="2026-11-01" required />
          </label>
          {numericFields.map((field) => (
            <label key={field.name}>{field.label}
              <input name={field.name} type="number" min="0" max={field.max ?? Number.MAX_SAFE_INTEGER}
                step="1" defaultValue={field.value} required />
            </label>
          ))}
          <label>우선 기준
            <select name="priority" defaultValue="cost">
              <option value="cost">비용 우선</option><option value="time">시간 우선</option>
            </select>
          </label>
        </div>
        <p className="hint">출근 0일은 교통비만 0원으로 계산하며 통근 조건은 그대로 적용합니다.</p>
        <button type="submit">{busy ? '비교 중…' : '이 조건으로 비교'}</button>
      </fieldset>
    </form>
  )
}
