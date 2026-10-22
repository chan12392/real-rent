import type { CompareResponse, CompareResult, Status } from '../lib/api'
import { STATUS_LABEL, STATUS_MARK, krw, legText, manwon } from '../lib/format'
import { mascotSkinRequested } from '../lib/persona'

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
  const byId = new Map(data.results.map((r) => [r.listing_id, r]))
  const picks = data.recommended.map((id) => byId.get(id)).filter((r): r is CompareResult => !!r)
  if (picks.length === 0) {
    return (
      <div className="empty">
        {mascotSkinRequested() && (
          <img
            className="empty-mascot"
            src="/skins/bogeum/sorry.png"
            alt=""
            aria-hidden="true"
            draggable={false}
            onError={(e) => {
              e.currentTarget.hidden = true
            }}
          />
        )}
        <p>조건을 모두 만족하는 매물이 없습니다. 예산이나 시간 상한을 조금 넓혀 보세요.</p>
      </div>
    )
  }
  return (
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
          {/* 금액 카드 묶음: 같은 .total 블록을 추가하면 나란히 놓인다. */}
          <div className="pick-figures">
            <p className="total">
              <span>월 지출 합계</span>
              <strong>{krw(r.cost.monthly_total_krw)}</strong>
              <em>{manwon(r.cost.monthly_total_krw)}</em>
            </p>
            <LivingFigure r={r} />
          </div>
          <LivingLine r={r} />
          <CostBar r={r} />
          <dl className="facts">
            <div>
              <dt>초기 필요 현금</dt>
              <dd>{krw(r.cost.initial_cash_krw)}</dd>
            </div>
            <div>
              <dt>거주 기간 총지출</dt>
              <dd>{krw(r.cost.stay_total_krw)}</dd>
            </div>
            <div>
              <dt>통근</dt>
              <dd>{legText(r)}</dd>
            </div>
          </dl>
          <ScoreAxes scores={r.scores} />
          <button type="button" className="link" onClick={() => onSelect(r.listing_id)}>
            상세 보기
          </button>
        </li>
      ))}
    </ol>
  )
}
