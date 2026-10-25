import { useState } from 'react'
import type { CompareResponse, CompareResult, Status } from '../lib/api'
import { STATUS_LABEL, STATUS_MARK, krw } from '../lib/format'
import { commuteDifference, duration } from '../lib/commuteComparison'
import { useSkin } from '../lib/skin-context'

export function StatusChip({ status }: { status: Status }) {
  return (
    <span className={`chip chip-${status}`}>
      <span aria-hidden="true">{STATUS_MARK[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  )
}

const ORDER: Status[] = ['pass', 'fail', 'unknown', 'route_failed']

export function Counts({ counts }: { counts: CompareResponse['counts'] }) {
  return (
    <ul className="counts" aria-label="판정 건수">
      {ORDER.map((s) => (
        <li key={s} className={`count count-${s}`}>
          <StatusChip status={s} />
          <strong>{counts[s] ?? 0}</strong>
          <span>건</span>
        </li>
      ))}
    </ul>
  )
}

export function CostBar({ r }: { r: CompareResult }) {
  const parts = [
    { key: 'rent', label: '월세', value: r.cost.monthly_rent_krw },
    { key: 'mgmt', label: '관리비', value: r.cost.monthly_management_krw },
    { key: 'commute', label: '통근비', value: r.cost.monthly_commute_krw },
  ]
  return (
    <div className="costbar">
      <div className="bar" role="img" aria-label={parts.map((p) => `${p.label} ${krw(p.value)}`).join(', ')}>
        {parts.map((p) =>
          p.value ? <span key={p.key} className={`seg-${p.key}`} style={{ flexGrow: p.value }} /> : null,
        )}
      </div>
      <ul className="legend">
        {parts.map((p) => (
          <li key={p.key}>
            <i className={`dot seg-${p.key}`} aria-hidden="true" />
            {p.label} <b>{krw(p.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 참고 합계가 null일 때 응답에서 찾을 수 있는 사유. 없으면 사유 미제공. */
function livingNullReason(r: CompareResult): string {
  const missing = r.living_cost?.items.find((i) => i.monthly_krw == null)
  if (missing) return `${missing.label} 미확인`
  return r.status === 'route_failed' ? '통근 경로 조회 실패' : '사유 미제공'
}

/** 카드용 “진짜 월 거주비(참고)”. 팀 미합의 시안이라 배지를 붙이고 판정·순위와 분리한다. */
export function LivingFigure({ r }: { r: CompareResult }) {
  const lc = r.living_cost
  if (!lc) return null
  const cash = lc.cash_monthly
  return (
    <p className="total total-ref">
      <span>
        진짜 월 거주비(참고) <small className="ref-badge">참고·시안</small>
      </span>
      {cash.amount_krw == null ? (
        <strong className="nodata">계산 불가 ({livingNullReason(r)})</strong>
      ) : (
        <>
          <strong>{krw(cash.amount_krw)}</strong>
          {cash.low_krw != null && cash.high_krw != null && (
            <em>
              범위 {krw(cash.low_krw)} ~ {krw(cash.high_krw)}
            </em>
          )}
          {cash.estimated_share_pct != null && <em>추정 비중 {cash.estimated_share_pct}%</em>}
        </>
      )}
    </p>
  )
}

/** 경제적 월 비용·입주 첫 달 필요 현금 한 줄 요약. 값이 없으면 계산 불가로 적는다. */
export function LivingLine({ r }: { r: CompareResult }) {
  const lc = r.living_cost
  if (!lc) return null
  const part = (label: string, v: number | null) => `${label} ${v == null ? '계산 불가' : krw(v)}`
  return (
    <p className="living-line">
      {part('경제적 월 비용', lc.economic_monthly.amount_krw)} · {part('입주 첫 달 필요 현금', lc.initial_cash.amount_krw)}
    </p>
  )
}

const AXES: Array<[keyof CompareResult['scores'], string]> = [
  ['cost', '비용'],
  ['time', '시간'],
  ['convenience', '편의'],
  ['livability', '거주성'],
]

export function ScoreAxes({ scores }: { scores: CompareResult['scores'] }) {
  return (
    <ul className="scores" aria-label="점수 4축 (시안)">
      {AXES.map(([key, label]) => {
        const v = scores[key]
        return (
          <li key={key}>
            <span className="axis">{label}</span>
            {v == null ? (
              <span className="nodata">{key === 'livability' ? '데이터 없음' : '계산 불가'}</span>
            ) : (
              <>
                <span className="meter" aria-hidden="true">
                  <i style={{ width: `${v}%` }} />
                </span>
                <b>{v}</b>
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}

type TopProps = {
  data: CompareResponse
  selectedId: string | null
  onSelect: (id: string) => void
}

export function TopPicks({ data, selectedId, onSelect }: TopProps) {
  const { skin, failSkin } = useSkin()
  const [baselineId, setBaselineId] = useState('')
  const byId = new Map(data.results.map((r) => [r.listing_id, r]))
  const picks = data.recommended.map((id) => byId.get(id)).filter((r): r is CompareResult => !!r)
  const comparable = data.results.filter((r) => r.cost.monthly_total_krw != null && r.commute.round_trip_minutes != null)
  const cheapest = [...comparable.filter((r) => r.status === 'pass')].sort((a, b) => a.cost.monthly_total_krw! - b.cost.monthly_total_krw!)[0]
  const baseline = comparable.find((r) => r.listing_id === baselineId) ?? cheapest
  if (picks.length === 0) {
    return (
      <div className="empty">
        {skin.folder && (
          <img
            className="empty-mascot"
            src={`${skin.folder}/sorry.png`}
            alt=""
            aria-hidden="true"
            draggable={false}
            onError={(e) => {
              e.currentTarget.hidden = true
              failSkin('sorry.png: 이미지를 표시할 수 없어요')
            }}
          />
        )}
        <p>조건을 모두 만족하는 매물이 없습니다. 예산이나 시간 상한을 조금 넓혀 보세요.</p>
      </div>
    )
  }
  return (
    <>
    {baseline && <div className="destination-note">
      <label htmlFor="commute-baseline"><strong>어느 집과 비교할까요?</strong></label>{' '}
      <select id="commute-baseline" value={baseline.listing_id} onChange={(e) => setBaselineId(e.target.value)}>
        {comparable.map((r) => <option key={r.listing_id} value={r.listing_id}>{r.listing_id} · {r.dong} · {STATUS_LABEL[r.status]}</option>)}
      </select>
      <p className="hint">기본 기준은 조건을 통과한 최저 월 지출 매물입니다. 탈락 매물도 비교 기준으로 선택할 수 있습니다. 월 {data.conditions.office_days}일 출근 · 왕복 합계 기준</p>
    </div>}
    <ol className="top3">
      {picks.map((r) => (
        <li key={r.listing_id} className={selectedId === r.listing_id ? 'pick selected' : 'pick'}>
          <div className="pick-head">
            <span className="rank" aria-label={`${r.rank}위`}>
              {r.rank}
            </span>
            <div>
              <h3>
                {r.listing_id} · {r.dong}
              </h3>
              <p className="sub">
                {r.gu} · {r.label}
              </p>
            </div>
          </div>
          <div className="commute-primary" aria-label="출퇴근 요약">
            <div><span>출근</span><strong>{r.commute.outbound?.minutes ?? '미확인'}분</strong><small>환승 {r.commute.outbound?.transfers ?? '미확인'}회 · 도보 {r.commute.outbound?.walk_minutes ?? '미확인'}분</small></div>
            <div><span>퇴근</span><strong>{r.commute.return?.minutes ?? '미확인'}분</strong><small>환승 {r.commute.return?.transfers ?? '미확인'}회 · 도보 {r.commute.return?.walk_minutes ?? '미확인'}분</small></div>
          </div>
          <p className="hint">도보는 통근 총시간에 포함 · 노선·배차·대기 상세 미제공</p>
          {baseline && <Difference base={baseline} candidate={r} days={data.conditions.office_days} />}
          <div className="pick-figures">
            <p className="total">
              <span>월 지출 합계</span>
              <strong>{krw(r.cost.monthly_total_krw)}</strong>
              <em>월세 + 관리비 + 통근비</em>
            </p>
          </div>
          <button type="button" className="link" onClick={() => onSelect(r.listing_id)}>
            상세 보기
          </button>
        </li>
      ))}
    </ol>
    </>
  )
}

function Difference({ base, candidate, days }: { base: CompareResult; candidate: CompareResult; days: number }) {
  if (base.listing_id === candidate.listing_id) return <p className="commute-difference">비교 기준 매물 · {base.listing_id} {base.dong}</p>
  const diff = commuteDifference(base, candidate, days)
  if (!diff) return <p>비교에 필요한 비용·통근값 미확인</p>
  return <div className="commute-difference">
    <strong>{base.listing_id} {base.dong} 대비</strong>
    <p>월 지출 {diff.cost === 0 ? '동일' : `${krw(Math.abs(diff.cost))} ${diff.cost > 0 ? '증가' : '감소'}`}</p>
    <p>하루 왕복 {diff.dailyMinutes === 0 ? '동일' : `${duration(diff.dailyMinutes)} ${diff.dailyMinutes > 0 ? '단축' : '증가'}`}</p>
    <p>월 통근 {diff.monthlyMinutes === 0 ? '차이 없음' : `${duration(diff.monthlyMinutes)} ${diff.monthlyMinutes > 0 ? '절약' : '증가'}`} · 월 {days}일 기준</p>
  </div>
}
