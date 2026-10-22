import { useEffect, useRef, useSyncExternalStore, type JSX } from 'react'
import { EXPRESSION_LABELS, type CharacterState, type ExpressionId } from './expressions'
import { CharacterRig } from './rig'
import './character.css'

export interface CharacterProps {
  state: CharacterState
  expression: ExpressionId
  /** 0..1, 기본 DEFAULT_INTENSITY[expression] */
  intensity?: number
  /** 키 입력마다 1씩 증가하는 카운터 → 미세한 끄덕임·시선 */
  typingPulse?: number
  /** 미지정이면 prefers-reduced-motion을 따른다 */
  reducedMotion?: boolean
  /** 화면 낭독용 상태 문장 */
  label?: string
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReduced(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia(REDUCED_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
const getReduced = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(REDUCED_QUERY).matches : false)

const STAR = 'M0 -7Q1.2 -1.2 7 0Q1.2 1.2 0 7Q-1.2 1.2 -7 0Q-1.2 -1.2 0 -7Z'

/** 자체 제작 SVG 캐릭터 "렌티". 표정 파라미터를 매 프레임 보간하며, 프레임마다 React 렌더를 일으키지 않는다. */
export function Character({ state, expression, intensity, typingPulse = 0, reducedMotion, label }: CharacterProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const rigRef = useRef<CharacterRig | null>(null)
  const lastPulse = useRef(typingPulse)
  const prefersReduced = useSyncExternalStore(subscribeReduced, getReduced, () => false)
  const reduced = reducedMotion ?? prefersReduced

  useEffect(() => {
    const rig = new CharacterRig(svgRef.current!)
    rigRef.current = rig
    return () => {
      rig.destroy()
      rigRef.current = null
    }
  }, [])

  useEffect(() => {
    rigRef.current?.setTarget(state, expression, intensity)
  }, [state, expression, intensity])

  useEffect(() => {
    rigRef.current?.setReducedMotion(reduced)
  }, [reduced])

  useEffect(() => {
    if (typingPulse > lastPulse.current) rigRef.current?.pulse()
    lastPulse.current = typingPulse
  }, [typingPulse])

  const shown = state === 'error' ? 'apologetic' : expression
  const ariaLabel = label ?? `렌티: ${EXPRESSION_LABELS[shown]}`

  return (
    <svg
      ref={svgRef}
      className="renti"
      viewBox="0 -14 200 234"
      role="img"
      aria-label={ariaLabel}
      data-state={state}
      data-expression={shown}
      data-reduced-motion={reduced ? 'true' : 'false'}
    >
      <ellipse data-part="shadow" className="renti-shadow" cx="100" cy="211" rx="50" ry="6.5" />
      <g data-part="body">
        <rect className="renti-body" x="64" y="146" width="72" height="62" rx="22" />
        <path className="renti-door" d="M89 208V188a11 11 0 0 1 22 0V208Z" />
        <circle className="renti-ink" cx="106" cy="199" r="1.7" />
      </g>
      <g data-part="head">
        <rect className="renti-face" x="38" y="70" width="124" height="98" rx="46" />
        <g data-part="roof">
          <rect className="renti-chimney" x="127" y="34" width="16" height="30" rx="3" />
          <path className="renti-roof" d="M33 95Q20 95 29 86L91 33Q100 25 109 33L171 86Q180 95 167 95Z" />
          <circle data-part="glow" className="renti-glow" cx="100" cy="68" r="14" opacity="0" />
          <circle className="renti-window" cx="100" cy="68" r="8" />
          <path className="renti-window-frame" d="M100 60V76M92 68H108" />
          <circle data-part="dot0" className="renti-puff" cx="139" cy="22" r="3.6" opacity="0" />
          <circle data-part="dot1" className="renti-puff" cx="148" cy="9" r="4.6" opacity="0" />
          <circle data-part="dot2" className="renti-puff" cx="160" cy="-5" r="5.6" opacity="0" />
        </g>
        <g data-part="features">
          <ellipse data-part="cheekL" className="renti-cheek" cx="63" cy="138" rx="9" ry="5.5" />
          <ellipse data-part="cheekR" className="renti-cheek" cx="137" cy="138" rx="9" ry="5.5" />
          <path data-part="browL" className="renti-brow" />
          <path data-part="browR" className="renti-brow" />
          <path data-part="eyeL" className="renti-eye" />
          <path data-part="eyeR" className="renti-eye" />
          <circle data-part="shineL" className="renti-shine" r="2.6" />
          <circle data-part="shineR" className="renti-shine" r="2.6" />
          <path data-part="mouth" className="renti-mouth" />
        </g>
        <path
          data-part="sweat"
          className="renti-sweat"
          d="M0 -7C3.5 -2 5.5 1 5.5 3.5A5.5 5.5 0 0 1 -5.5 3.5C-5.5 1 -3.5 -2 0 -7Z"
          opacity="0"
        />
        <path data-part="sparkleA" className="renti-sparkle" d={STAR} opacity="0" />
        <path data-part="sparkleB" className="renti-sparkle" d={STAR} opacity="0" />
      </g>
    </svg>
  )
}
