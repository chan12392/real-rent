import type { CompareResult, Listing, Status } from '../lib/api'
import { STATUS_LABEL } from '../lib/format'

const W = 640
const H = 380
const PAD = 44

function Marker({ status, r }: { status: Status; r: number }) {
  switch (status) {
    case 'pass':
      return <circle r={r} />
    case 'fail':
      return <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={2} />
    case 'unknown':
      return <polygon points={`0,${-r * 1.3} ${r * 1.3},0 0,${r * 1.3} ${-r * 1.3},0`} />
    default:
      return <polygon points={`0,${-r * 1.2} ${r * 1.2},${r} ${-r * 1.2},${r}`} />
  }
}

type Props = {
  listings: Listing[]
  results: CompareResult[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function MapView({ listings, results, selectedId, onSelect }: Props) {
  const status = new Map(results.map((r) => [r.listing_id, r]))
  const lats = listings.map((l) => l.lat)
  const lngs = listings.map((l) => l.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const x = (lng: number) => PAD + ((lng - minLng) / (maxLng - minLng || 1)) * (W - PAD * 2)
  const y = (lat: number) => H - PAD - ((lat - minLat) / (maxLat - minLat || 1)) * (H - PAD * 2)

  return (
    <figure className="map">
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="매물 위치 산점도 (동 단위 대표 좌표)">
        <rect className="map-bg" x="0" y="0" width={W} height={H} rx="14" />
        {[0.25, 0.5, 0.75].map((t) => (
          <g key={t} className="grid">
            <line x1={PAD + t * (W - PAD * 2)} x2={PAD + t * (W - PAD * 2)} y1="14" y2={H - 14} />
            <line y1={PAD + t * (H - PAD * 2)} y2={PAD + t * (H - PAD * 2)} x1="14" x2={W - 14} />
          </g>
        ))}
        <text className="axis-note" x={W - 18} y="26" textAnchor="end">
          북 ↑
        </text>
        <text className="axis-note" x={W - 18} y={H - 14} textAnchor="end">
          동 →
        </text>
        {listings.map((l) => {
          const r = status.get(l.listing_id)
          const st: Status = r?.status ?? 'unknown'
          const sel = l.listing_id === selectedId
          return (
            <g
              key={l.listing_id}
              className={`mk mk-${st}${sel ? ' sel' : ''}`}
              transform={`translate(${x(l.lng)} ${y(l.lat)})`}
              tabIndex={0}
              role="button"
              aria-label={`${l.listing_id} ${l.dong}, ${STATUS_LABEL[st]}`}
              aria-pressed={sel}
              onClick={() => onSelect(l.listing_id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(l.listing_id)
                }
              }}
            >
              <title>{`${l.listing_id} · ${l.gu} ${l.dong} · ${STATUS_LABEL[st]}`}</title>
              {sel && <circle className="halo" r="17" />}
              <circle className="focus-ring" r="16" />
              <Marker status={st} r={9} />
              <text y="-14" textAnchor="middle">
                {l.listing_id}
              </text>
            </g>
          )
        })}
      </svg>
      <ul className="map-legend" aria-label="범례">
        {(['pass', 'fail', 'unknown', 'route_failed'] as Status[]).map((s) => (
          <li key={s}>
            <svg width="20" height="20" viewBox="-12 -12 24 24" aria-hidden="true" className={`mk-${s}`}>
              <Marker status={s} r={7} />
            </svg>
            {STATUS_LABEL[s]}
          </li>
        ))}
      </ul>
      <figcaption>
        ※ 동 단위 대표 좌표입니다. 실제 건물 위치가 아니며, 지도·타일 없이 위도·경도만으로 그렸습니다.
      </figcaption>
    </figure>
  )
}
