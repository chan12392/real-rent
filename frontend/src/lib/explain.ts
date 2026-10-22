// 비교 응답 → 설명 문장. 숫자는 응답 필드(또는 응답 값끼리의 차이)에서만 만든다.
import type { CompareResponse, CompareResult } from './api'
import { krw } from './format.ts'
import { casualize } from './persona.ts'

/** 말투. 숫자·매물명·금액을 만드는 로직은 같고, 문장 틀(어미)만 tone 에 따라 다르다. */
export type Tone = 'polite' | 'casual'

export type ExplainKind = 'pass' | 'none' | 'error'
export type Explanation = { kind: ExplainKind; text: string }

export const SYNTH_NOTE = '합성 시연 데이터 기준이에요. 실제 매물·가격이 아니에요.'
export const SYNTH_NOTE_CASUAL = '합성 시연 데이터 기준이야. 실제 매물·가격 아니야.'
export const UNCONFIRMED = '미확인'

const money = (v: number | null) => (v == null ? UNCONFIRMED : krw(v))
const minutes = (v: number | null) => (v == null ? UNCONFIRMED : `${v}분`)

function diffPhrase(value: number | null, base: number | null, unit: 'won' | 'min'): string {
  if (value == null || base == null) return UNCONFIRMED
  const d = value - base
  if (d === 0) return '1위와 같음'
  const amount = unit === 'won' ? krw(Math.abs(d)) : `${Math.abs(d)}분`
  if (unit === 'won') return `1위보다 ${amount} ${d > 0 ? '더 듦' : '덜 듦'}`
  return `1위보다 ${amount} ${d > 0 ? '더 걸림' : '덜 걸림'}`
}

/** 참고 월 거주비 문장. 숫자는 응답 값만 쓰고, 합계가 null이면 문장을 만들지 않는다. */
function livingSentence(r: CompareResult, tone: Tone): string | null {
  const cash = r.living_cost?.cash_monthly
  if (!cash || cash.amount_krw == null) return null
  const range =
    cash.low_krw != null && cash.high_krw != null
      ? `(범위 ${krw(cash.low_krw).replace('원', '')}~${krw(cash.high_krw)})`
      : ''
  const head = `부대경비까지 넣은 참고 월 거주비는 ${krw(cash.amount_krw)}${range}`
  return tone === 'casual' ? `${head}이야.` : `${head}이에요.`
}

function topPicks(data: CompareResponse): CompareResult[] {
  return data.results
    .filter((r) => r.status === 'pass')
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
    .slice(0, 3)
}

function countsLine(data: CompareResponse): string {
  const c = data.counts
  return `통과 ${c.pass}건 · 탈락 ${c.fail}건 · 판단 불가 ${c.unknown}건 · 경로 실패 ${c.route_failed}건`
}

export function explainCompare(data: CompareResponse, tone: Tone = 'polite'): Explanation {
  const casual = tone === 'casual'
  const note = casual ? SYNTH_NOTE_CASUAL : SYNTH_NOTE
  const picks = topPicks(data)
  if (picks.length === 0) {
    const reasons = new Map<string, number>()
    for (const r of data.results) {
      if (r.status === 'pass' || !r.primary_reason) continue
      reasons.set(r.primary_reason, (reasons.get(r.primary_reason) ?? 0) + 1)
    }
    const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    const lines = [
      casual
        ? `조건에 맞는 매물이 없어. 전체 ${data.results.length}건 중 ${countsLine(data)}이야.`
        : `조건에 맞는 매물이 없어요. 전체 ${data.results.length}건 중 ${countsLine(data)}이에요.`,
    ]
    if (top.length > 0) {
      lines.push(`주요 탈락 사유: ${top.map(([reason, n]) => `${reason}(${n}건)`).join(', ')}`)
    }
    lines.push(casual ? '왼쪽 조건을 조정해 다시 비교해 볼 수 있어.' : '왼쪽 조건을 조정해 다시 비교해 볼 수 있어요.', note)
    return { kind: 'none', text: lines.join('\n') }
  }

  const first = picks[0]
  const firstTotal = first.cost.monthly_total_krw
  const firstTrip = first.commute.round_trip_minutes
  const lines = [
    casual
      ? `비교 끝났어! 전체 ${data.results.length}건 중 ${countsLine(data)}이야.`
      : `비교가 끝났어요. 전체 ${data.results.length}건 중 ${countsLine(data)}이에요.`,
    `1위 ${first.label}: 월 지출 ${money(firstTotal)}, 왕복 ${minutes(firstTrip)}`,
  ]
  const living = livingSentence(first, tone)
  if (living) lines.push(living)
  picks.slice(1).forEach((p, i) => {
    const total = p.cost.monthly_total_krw
    const trip = p.commute.round_trip_minutes
    lines.push(
      `${i + 2}위 ${p.label}: 월 지출 ${money(total)}(${diffPhrase(total, firstTotal, 'won')}), ` +
        `왕복 ${minutes(trip)}(${diffPhrase(trip, firstTrip, 'min')})`,
    )
  })
  lines.push(note)
  return { kind: 'pass', text: lines.join('\n') }
}

/** API 오류. “매물 없음”과 다른 문장이어야 한다. */
export function explainError(message?: string, tone: Tone = 'polite'): Explanation {
  const detail = message ? ` (${message})` : ''
  if (tone === 'casual') {
    // 상세는 호출한 쪽이 만든 문구라 어미가 존댓말일 수 있다. 숫자·따옴표 안은 casualize 가 보존한다.
    const said = message ? ` (${casualize(message)})` : ''
    return {
      kind: 'error',
      text: `서버 오류로 비교 결과를 받지 못했어${said}. 조건에 맞는 매물이 없다는 뜻은 아니야. 잠시 뒤 다시 비교해 줘.`,
    }
  }
  return {
    kind: 'error',
    text: `서버 오류로 비교 결과를 받지 못했어요${detail}. 조건에 맞는 매물이 없다는 뜻은 아니에요. 잠시 뒤 다시 비교해 주세요.`,
  }
}
