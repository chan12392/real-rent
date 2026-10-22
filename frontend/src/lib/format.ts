import type { CompareResult } from './api'
const won = new Intl.NumberFormat('ko-KR')

export function krw(value: number | null | undefined): string {
  return value == null ? '확인 불가' : `${won.format(value)}원`
}

/** 금액 보조 표시. 10,500,000 → "1,050만원", 632,000 → "63.2만원". */
export function manwon(value: number | null | undefined): string {
  if (value == null) return ''
  const man = value / 10000
  const text = Number.isInteger(man) ? won.format(man) : won.format(Math.round(man * 10) / 10)
  return `${text}만원`
}

export function num(value: number): string {
  return won.format(value)
}

export const STATUS_LABEL = {
  pass: '통과',
  fail: '탈락',
  unknown: '판단 불가',
  route_failed: '경로 실패',
} as const

export const STATUS_MARK = {
  pass: '✓',
  fail: '✕',
  unknown: '?',
  route_failed: '!',
} as const

export function legText(r: CompareResult): string {
  const rt = r.commute.round_trip_minutes
  const o = r.commute.outbound
  const b = r.commute.return
  if (rt == null || !o || !b) return '경로 없음'
  return `왕복 ${rt}분 · 환승 ${o.transfers}+${b.transfers}회`
}

