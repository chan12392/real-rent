import type { CompareRequest, Heating, Priority } from './api'

export type FormState = {
  deposit: string
  budget: string
  moveIn: string
  officeDays: string
  maxMinutes: string
  maxTransfers: string
  stayMonths: string
  priority: Priority
  /** 생활 조건(참고 계산용) */
  persons: string
  heating: Heating
}

export const DEFAULT_FORM: FormState = {
  deposit: '10000000',
  budget: '750000',
  moveIn: '2026-11-01',
  officeDays: '20',
  maxMinutes: '40',
  maxTransfers: '1',
  stayMonths: '12',
  priority: 'cost',
  persons: '1',
  heating: 'individual_gas',
}

export const digits = (v: string) => v.replace(/[^\d]/g, '')

/** 입력 문자열 → 요청 본문. 잘못된 값이 있으면 오류 문구 목록을 돌려준다. */
export function buildRequest(
  f: FormState,
  overrides: Record<string, number>,
): CompareRequest | string[] {
  const errors: string[] = []
  const pick = (label: string, raw: string, min = 0, max = Number.POSITIVE_INFINITY) => {
    if (raw.trim() === '') {
      errors.push(`${label}을(를) 입력해 주세요.`)
      return 0
    }
    const n = Number(raw)
    if (!Number.isInteger(n) || n < min || n > max) {
      const range = Number.isFinite(max) ? `${min}~${max}` : `${min} 이상`
      errors.push(`${label}은(는) ${range}의 정수로 입력해 주세요.`)
    }
    return n
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.moveIn)) errors.push('입주 희망일을 선택해 주세요.')
  const req: CompareRequest = {
    deposit_limit_krw: pick('보증금 한도', f.deposit),
    monthly_budget_krw: pick('월 예산', f.budget),
    move_in_by: f.moveIn,
    office_days: pick('월 출근일', f.officeDays, 0, 31),
    max_one_way_minutes: pick('편도 최대 시간', f.maxMinutes, 1),
    max_transfers: pick('최대 환승', f.maxTransfers),
    priority: f.priority,
    stay_months: pick('거주 기간', f.stayMonths, 1, 60),
  }
  const persons = pick('인원', f.persons, 1, 6)
  if (errors.length) return errors
  if (Object.keys(overrides).length) req.management_overrides = overrides
  // 기본값(1인·개별가스)이면 생략한다. 서버가 같은 기본값으로 계산한다.
  if (persons !== 1 || f.heating !== 'individual_gas') req.living = { persons, heating: f.heating }
  return req
}

/** 대화에서 확인된 조건 후보가 가리킬 수 있는 요청 필드. */
export const CHANGE_FIELDS = [
  'deposit_limit_krw',
  'monthly_budget_krw',
  'move_in_by',
  'office_days',
  'max_one_way_minutes',
  'max_transfers',
  'priority',
  'stay_months',
] as const
export type ChangeField = (typeof CHANGE_FIELDS)[number]
export type Change = { field: ChangeField; value: unknown }

const FORM_KEY: Record<ChangeField, keyof FormState> = {
  deposit_limit_krw: 'deposit',
  monthly_budget_krw: 'budget',
  move_in_by: 'moveIn',
  office_days: 'officeDays',
  max_one_way_minutes: 'maxMinutes',
  max_transfers: 'maxTransfers',
  priority: 'priority',
  stay_months: 'stayMonths',
}

export function isChangeField(field: unknown): field is ChangeField {
  return typeof field === 'string' && (CHANGE_FIELDS as readonly string[]).includes(field)
}

/** 요청 필드 값 → 폼 값. 형식이 맞지 않으면 null (반영하지 않는다). */
export function changeToForm(change: Change): Partial<FormState> | null {
  const { field, value } = change
  if (!isChangeField(field)) return null
  if (field === 'priority') return value === 'cost' || value === 'time' ? { priority: value } : null
  if (field === 'move_in_by') {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? { moveIn: value } : null
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null
  return { [FORM_KEY[field]]: String(value) }
}

/** 확인된 변경만 폼에 반영한다. 반영할 수 없는 값은 건너뛰고 기존 값을 유지한다. */
export function applyChanges(form: FormState, changes: Change[]): FormState {
  let next = form
  for (const change of changes) {
    const patch = changeToForm(change)
    if (patch) next = { ...next, ...patch }
  }
  return next
}
