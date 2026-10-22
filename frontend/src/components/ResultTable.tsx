import { useId, useState } from 'react'
import type { CompareResult, LivingCost, LivingItem, Listing } from '../lib/api'
import { krw, legText, manwon, num } from '../lib/format'
import { livingParamLabel } from '../lib/livingLabels'
import { CostBar, LivingFigure, LivingLine, ScoreAxes, StatusChip } from './Summary'

function sortRows(rows: CompareResult[]): CompareResult[] {
  const order = { pass: 0, unknown: 1, fail: 2, route_failed: 3 } as const
  return [...rows].sort((a, b) => {
    if (a.status !== b.status) return order[a.status] - order[b.status]
    if (a.rank != null && b.rank != null) return a.rank - b.rank
    return a.listing_id.localeCompare(b.listing_id)
  })
}

type TableProps = {
  rows: CompareResult[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function ResultTable({ rows, selectedId, onSelect }: TableProps) {
  return (
    <div className="table-wrap">
      <table className="results">
        <caption className="sr-only">
          전체 {rows.length}건 비교. 통과 매물이 순위 순으로 먼저 나옵니다.
        </caption>
        <thead>
          <tr>
            <th scope="col">매물</th>
            <th scope="col">상태</th>
            <th scope="col">사유</th>
            <th scope="col" className="num">월 지출</th>
            <th scope="col" className="num">보증금</th>
            <th scope="col" className="num">왕복</th>
            <th scope="col" className="num">순위</th>
          </tr>
        </thead>
        <tbody>
          {sortRows(rows).map((r) => (
            <tr key={r.listing_id} className={r.listing_id === selectedId ? 'selected' : undefined}>
              <th scope="row" data-label="매물">
                <button
                  type="button"
                  className="row-btn"
                  aria-pressed={r.listing_id === selectedId}
                  onClick={() => onSelect(r.listing_id)}
                >
                  <b>{r.listing_id}</b>
                  <span>
                    {r.gu} {r.dong}
                  </span>
                </button>
              </th>
              <td data-label="상태">
                <StatusChip status={r.status} />
              </td>
              <td data-label="사유" className="reason">
                {r.primary_reason ?? '모든 조건 충족'}
                {r.reasons.length > 1 && <small> 외 {r.reasons.length - 1}건</small>}
              </td>
              <td data-label="월 지출" className="num">
                {r.cost.monthly_total_krw == null ? (
                  <span className="nodata">계산 불가</span>
                ) : (
                  <>
                    {num(r.cost.monthly_total_krw)}원
                    {r.management_overridden && <small className="tag">직접 입력</small>}
                  </>
                )}
              </td>
              <td data-label="보증금" className="num">
                {num(r.cost.deposit_krw)}원
              </td>
              <td data-label="왕복" className="num">
                {r.commute.round_trip_minutes == null ? (
                  <span className="nodata">경로 없음</span>
                ) : (
                  `${r.commute.round_trip_minutes}분`
                )}
              </td>
              <td data-label="순위" className="num">
                {r.rank ?? '–'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const range = (lo: number | null, hi: number | null) =>
  lo == null || hi == null ? '–' : `${num(lo)}~${num(hi)}원`
const won = (v: number | null) => (v == null ? '계산 불가' : `${num(v)}원`)

function LivingRow({ item }: { item: LivingItem }) {
  return (
    <tr>
      <th scope="row" data-label="항목">
        {item.label}
      </th>
      <td className="num" data-label="월">
        {won(item.monthly_krw)}
      </td>
      <td className={item.one_time_krw ? 'num' : 'num none'} data-label="일회성">
        {item.one_time_krw ? won(item.one_time_krw) : '–'}
      </td>
      <td className="num" data-label="범위">
        {range(item.low_krw, item.high_krw)}
      </td>
      <td className="basis" data-label="근거">
        {item.basis}
        {item.estimated && <small className="tag">추정</small>}
      </td>
      <td className="note" data-label="비고">
        {item.note}
      </td>
    </tr>
  )
}

const PEAK_LABEL: Array<['electricity' | 'gas', string]> = [
  ['electricity', '전기'],
  ['gas', '가스'],
]

/** 참고 월 거주비 상세. 팀 미합의 시안이며 판정·순위에 쓰지 않는다. */
function LivingDetail({ r, lc }: { r: CompareResult; lc: LivingCost }) {
  const unverified = Object.entries(lc.parameter_status ?? {}).filter(([, v]) => v.includes('검증 필요'))
  const peaks = PEAK_LABEL.map(([key, label]) => ({ label, peak: lc.peak?.[key] })).filter(
    (p): p is { label: string; peak: NonNullable<typeof p.peak> } => !!p.peak,
  )
  return (
    <div className="living-detail">
      <div className="pick-figures">
        <LivingFigure r={r} />
      </div>
      <LivingLine r={r} />
      {lc.management_estimated && (
        <p className="living-warn">관리비 미확인이라 면적 없는 통계로 추정한 값이에요. 참고 추정은 기존 판정에 쓰지 않아요.</p>
      )}
      <h4>월 거주비 항목별 내역</h4>
      <div className="table-wrap">
        <table className="results living-table">
          <caption className="sr-only">참고 월 거주비 항목표</caption>
          <thead>
            <tr>
              <th scope="col">항목</th>
              <th scope="col" className="num">월</th>
              <th scope="col" className="num">일회성</th>
              <th scope="col" className="num">범위</th>
              <th scope="col">근거</th>
              <th scope="col">비고</th>
            </tr>
          </thead>
          <tbody>
            {lc.items.map((item) => (
              <LivingRow key={item.key} item={item} />
            ))}
          </tbody>
        </table>
      </div>
      {peaks.length > 0 && (
        <p className="living-peak">
          최고 달:{' '}
          {peaks.map((p) => `${p.label} ${p.peak.month}월 ${num(p.peak.amount_krw)}원`).join(' · ')}
        </p>
      )}
      {unverified.length > 0 && (
        <details className="living-warn" role="note">
          <summary>⚠ 검증 필요 값 {unverified.length}개</summary>
          <p>{unverified.map(([k]) => livingParamLabel(k)).join(' · ')}</p>
        </details>
      )}
    </div>
  )
}

/** 직접 입력 관리비 상한(원). 이보다 크면 입력 실수로 보고 거절한다. */
const MAX_MANAGEMENT_KRW = 10_000_000

type Parsed = { ok: true; value: number } | { ok: false; message: string }

/** 입력란 문자열을 검사해 안전한 정수 원 단위로 바꾼다. 상태·요청에는 통과한 값만 쓴다. */
function parseManagementKrw(raw: string): Parsed {
  const cleaned = raw.replace(/[^\d]/g, '')
  if (cleaned === '') return { ok: false, message: '관리비를 숫자로 입력해 주세요. (0원이면 0)' }
  const value = Number(cleaned)
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MANAGEMENT_KRW) {
    return { ok: false, message: `관리비가 너무 커요. ${num(MAX_MANAGEMENT_KRW)}원 이하로 입력해 주세요.` }
  }
  return { ok: true, value }
}

type DetailProps = {
  result: CompareResult
  listing: Listing | undefined
  override: number | undefined
  busy: boolean
  onOverride: (id: string, value: number | null) => void
  onAsk: (id: string) => void
  onClose: () => void
}

export function Detail({ result: r, listing, override, busy, onOverride, onAsk, onClose }: DetailProps) {
  const inputId = useId()
  const [raw, setRaw] = useState('')
  const [err, setErr] = useState('')
  // 폼 표시는 최종 판정이 아니라 관리비 값 자체로 정한다. 다른 사유로 fail 이어도 확인한 값을 넣을 수 있다.
  const needsMgmt = r.cost.monthly_management_krw == null || override != null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = parseManagementKrw(raw)
    if (!parsed.ok) {
      setErr(parsed.message)
      return
    }
    setErr('')
    onOverride(r.listing_id, parsed.value)
    setRaw('')
  }

  const legs: Array<[string, CompareResult['commute']['outbound']]> = [
    ['출근', r.commute.outbound],
    ['퇴근', r.commute.return],
  ]

  return (
    <section className="detail panel" aria-labelledby="detail-title">
      <div className="detail-head">
        <div>
          <p className="step">선택한 매물</p>
          <h3 id="detail-title">
            {r.listing_id} · {r.gu} {r.dong}
          </h3>
        </div>
        <StatusChip status={r.status} />
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>

      {r.reasons.length > 0 && (
        <ul className="reasons">
          {r.reasons.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}

      <div className="detail-grid">
        <div>
          <h4>비용</h4>
          <CostBar r={r} />
          <dl className="facts">
            <div>
              <dt>월 지출 합계</dt>
              <dd>{krw(r.cost.monthly_total_krw)}</dd>
            </div>
            <div>
              <dt>보증금</dt>
              <dd>
                {krw(r.cost.deposit_krw)} <small>({manwon(r.cost.deposit_krw)})</small>
              </dd>
            </div>
            <div>
              <dt>초기 필요 현금</dt>
              <dd>{krw(r.cost.initial_cash_krw)}</dd>
            </div>
            <div>
              <dt>거주 기간 총지출</dt>
              <dd>{krw(r.cost.stay_total_krw)}</dd>
            </div>
          </dl>
        </div>
        <div>
          <h4>통근 · 입주</h4>
          <dl className="facts">
            {legs.map(([name, leg]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>
                  {leg
                    ? `${leg.minutes}분 · 환승 ${leg.transfers}회 · 도보 ${leg.walk_minutes}분 · ${krw(leg.fare_krw)}`
                    : '경로 조회 실패'}
                </dd>
              </div>
            ))}
            <div>
              <dt>입주 가능일</dt>
              <dd>{listing?.move_in_available ?? '–'}</dd>
            </div>
            <div>
              <dt>관리비 포함</dt>
              <dd>
                {listing == null
                  ? '–'
                  : listing.management_includes.length
                    ? listing.management_includes.join(' · ')
                    : '확인되지 않음'}
              </dd>
            </div>
          </dl>
          <ScoreAxes scores={r.scores} />
        </div>
      </div>

      {r.living_cost && <LivingDetail r={r} lc={r.living_cost} />}

      {needsMgmt && (
        <form className="override" onSubmit={submit} noValidate>
          <label htmlFor={inputId}>
            {override != null
              ? `직접 입력한 관리비: ${krw(override)}`
              : '관리비를 알고 있다면 입력해 주세요'}
          </label>
          <div className="override-row">
            <div className="input-unit">
              <input
                id={inputId}
                inputMode="numeric"
                autoComplete="off"
                placeholder="예: 60000"
                value={raw}
                onChange={(e) => {
                  setRaw(e.target.value.replace(/[^\d]/g, ''))
                  setErr('')
                }}
                aria-describedby={`${inputId}-msg`}
                aria-invalid={err ? true : undefined}
              />
              <span aria-hidden="true">원</span>
            </div>
            <button type="submit" className="primary small" disabled={busy}>
              이 관리비로 다시 계산
            </button>
            {override != null && (
              <button type="button" className="ghost" disabled={busy} onClick={() => onOverride(r.listing_id, null)}>
                입력 취소
              </button>
            )}
          </div>
          <p className="hint" id={`${inputId}-msg`} role="status">
            {err || (raw && Number.isSafeInteger(Number(raw)) ? `= ${manwon(Number(raw))}` : raw ? '' : '입력한 값은 이 화면에서만 쓰이며 저장되지 않습니다.')}
          </p>
        </form>
      )}

      <button type="button" className="link" onClick={() => onAsk(r.listing_id)}>
        이 매물에 대해 근거 질문하기 →
      </button>
      <p className="sr-only">{legText(r)}</p>
    </section>
  )
}
