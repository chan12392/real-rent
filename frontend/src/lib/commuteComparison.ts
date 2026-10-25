import type { CompareResult } from './api'

export function commuteDifference(base: CompareResult, candidate: CompareResult, days: number) {
  const baseMinutes = base.commute.round_trip_minutes
  const minutes = candidate.commute.round_trip_minutes
  const baseCost = base.cost.monthly_total_krw
  const cost = candidate.cost.monthly_total_krw
  if (baseMinutes == null || minutes == null || baseCost == null || cost == null) return null
  return { cost: cost - baseCost, dailyMinutes: baseMinutes - minutes, monthlyMinutes: (baseMinutes - minutes) * days }
}

export function duration(minutes: number) {
  const value = Math.abs(minutes)
  const hours = Math.floor(value / 60)
  const rest = value % 60
  return hours ? `${hours}시간${rest ? ` ${rest}분` : ''}` : `${rest}분`
}
