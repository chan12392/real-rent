import type { Comparison } from './types'

const won = (amount: number) => `${amount.toLocaleString('ko-KR')}원`

export function ComparisonResults({ result }: { result: Comparison }) {
  const input = result.conditions
  return (
    <section className="results" aria-labelledby="results-title">
      <div className="results-heading">
        <h2 id="results-title">비교 결과</h2>
        <p role="status">전체 {result.evaluated_count}건 중 조건 충족 {result.matched_count}건 · 최대 3건 표시</p>
      </div>
      <p className="applied-conditions">
        {result.office.label} · 입주 {input.move_in_date} · 보증금 ≤ {won(input.deposit_limit_krw)} ·
        월 지출 ≤ {won(input.monthly_limit_krw)} · 월 {input.workdays}일 출근 ·
        편도 {input.max_commute_minutes}분 / 환승 {input.max_transfers}회 이하 ·
        {input.priority === 'cost' ? ' 비용 우선' : ' 시간 우선'}
      </p>
      {result.candidates.length === 0 && <div className="panel empty-state">
        <h3>조건에 맞는 시연 매물이 없습니다.</h3>
        <p>아래 제외 이유를 확인하고 바꿀 조건을 직접 선택해 주세요.</p>
      </div>}
      <div className="candidate-grid">
        {result.candidates.map((candidate, index) => (
          <article className="panel candidate" key={candidate.listing.id}>
            <p className="eyebrow">{index + 1}번째 · 가상 매물</p>
            <h3>{candidate.listing.label}</h3>
            <p className="muted">{candidate.listing.area}</p>
            <p className="monthly-total"><strong>{won(candidate.monthly_total_krw)}</strong> / 월</p>
            <dl className="cost-breakdown">
              <div><dt>보증금 (별도)</dt><dd>{won(candidate.listing.deposit_krw)}</dd></div>
              <div><dt>월세</dt><dd>{won(candidate.listing.monthly_rent_krw)}</dd></div>
              <div><dt>관리비</dt><dd>{candidate.listing.monthly_management_krw === null
                ? '미확인' : won(candidate.listing.monthly_management_krw)}</dd></div>
              <div><dt>월 통근비</dt><dd>{won(candidate.monthly_commute_krw)}</dd></div>
              <div><dt>입주 가능일</dt><dd>{candidate.listing.available_from}</dd></div>
            </dl>
            <p className="hint">관리비 포함: {candidate.listing.management_includes.join(', ') || '표기 없음'}</p>
            <table className="commute-table">
              <caption>왕복 {candidate.round_trip_minutes}분 · 도보 포함</caption>
              <thead><tr><th scope="col">방향</th><th scope="col">시간</th><th scope="col">환승</th><th scope="col">도보</th></tr></thead>
              <tbody>
                <tr><th scope="row">출근</th><td>{candidate.outbound.minutes}분</td><td>{candidate.outbound.transfers}회</td><td>{candidate.outbound.walk_minutes}분</td></tr>
                <tr><th scope="row">퇴근</th><td>{candidate.inbound.minutes}분</td><td>{candidate.inbound.transfers}회</td><td>{candidate.inbound.walk_minutes}분</td></tr>
              </tbody>
            </table>
            <p className="hint">교통비: ({won(candidate.outbound.fare_krw)} + {won(candidate.inbound.fare_krw)}) × {input.workdays}일</p>
          </article>
        ))}
      </div>
      {result.excluded.length > 0 && <details className="panel excluded" open>
        <summary>비교에서 제외된 매물 {result.excluded.length}건</summary>
        <ul>{result.excluded.map((item) => (
          <li key={item.id}><strong>{item.label}</strong>: {item.reasons.join(' · ')}</li>
        ))}</ul>
      </details>}
      <p className="hint">별도 공과금·정기권 할인·시간의 금전 환산은 합계에서 제외했습니다. {result.note}</p>
    </section>
  )
}
