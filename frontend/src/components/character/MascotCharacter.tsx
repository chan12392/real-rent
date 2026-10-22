import { useEffect, useRef, useState, useSyncExternalStore, type JSX } from 'react'
import { clamp, DEFAULT_INTENSITY, EXPRESSION_LABELS, type CharacterState, type ExpressionId } from './expressions'
import { Character as Renti, type CharacterProps } from './Character'
import { stepSpring, type Spring } from './rig'
import './mascot.css'

// 팀 오리지널 마스코트 "보금이" 이미지 스킨. 표정 이미지 6장 + 눈 깜박임 1장을 겹쳐 두고,
// 불투명도(크로스페이드)와 몸 transform을 rAF에서 직접 갱신한다(프레임마다 React 렌더 없음).

type MascotProps = CharacterProps & { skinDir?: string; name?: string; credit?: string; onSkinError?: (reason: string) => void }
const FACES = ['neutral', 'excited', 'thinking', 'worried', 'surprised', 'sorry'] as const
type Face = (typeof FACES)[number]

const FACE_OF: Record<ExpressionId, Face> = {
  neutral: 'neutral',
  listening: 'neutral',
  thinking: 'thinking',
  happy: 'excited',
  empathetic: 'worried',
  concerned: 'worried',
  surprised: 'surprised',
  apologetic: 'sorry',
}

function resolveFace(state: CharacterState, expression: ExpressionId): Face {
  if (state === 'error') return 'sorry'
  if (state === 'thinking' || state === 'comparing') return 'thinking'
  return FACE_OF[expression]
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'
function subscribeReduced(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia(REDUCED_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
const getReduced = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(REDUCED_QUERY).matches : false)

const FADE_SEC = 0.18
const BLINK_SEC = 0.12
const BLINK_Z = 1_000_000
const SUBSTEP = 1 / 120
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo)
const fmt = (n: number) => n.toFixed(3)

type FaceElements = Record<Face, HTMLElement | null>

class MascotRig {
  private readonly alpha = Object.fromEntries(FACES.map((f) => [f, 0])) as Record<Face, number>
  private readonly shown = Object.fromEntries(FACES.map((f) => [f, -1])) as Record<Face, number>
  private current: Face | null = null
  private zTop = 1
  private amp = 1
  private lean = false
  private tiltOn = false
  private swayOn = false
  private reduced = false
  private destroyed = false
  private raf = 0
  private last = 0
  private time = 0
  private blinkNext = rand(2.5, 6)
  private blinkUntil = -1
  private blinkShown = false
  private lastTransform = ''

  // 스프링: 눌림(squash), 끄덕임, 앞으로 기울임, 생각 기울임, 좌우 흔들림 세기
  private readonly sq: Spring = { x: 0, v: 0 }
  private readonly nod: Spring = { x: 0, v: 0 }
  private readonly leanS: Spring = { x: 0, v: 0 }
  private readonly tiltS: Spring = { x: 0, v: 0 }
  private readonly swayS: Spring = { x: 0, v: 0 }

  private readonly body: HTMLElement
  private readonly layers: FaceElements
  private readonly blinkEl: HTMLElement | null

  constructor(body: HTMLElement, layers: FaceElements, blinkEl: HTMLElement | null) {
    this.body = body
    this.layers = layers
    this.blinkEl = blinkEl
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  setTarget(state: CharacterState, expression: ExpressionId, intensity: number) {
    const face = resolveFace(state, expression)
    this.amp = 0.4 + 0.8 * clamp(intensity, 0, 1)
    this.lean = expression === 'listening' || state === 'listening'
    this.tiltOn = face === 'thinking' && state !== 'comparing'
    this.swayOn = state === 'thinking' || state === 'comparing'
    if (face !== this.current) {
      const first = this.current === null
      this.current = face
      const el = this.layers[face]
      if (el) el.style.zIndex = String(++this.zTop)
      if (first || this.reduced) {
        for (const f of FACES) this.alpha[f] = f === face ? 1 : 0
        this.applyLayers()
      } else {
        this.sq.v = Math.min(this.sq.v + 16, 24) // 말랑하게 눌렸다 튀어 오르는 스프링
      }
    }
    if (this.reduced) this.applyStatic()
    else this.ensureRunning()
  }

  setReducedMotion(reduced: boolean) {
    this.reduced = reduced
    if (reduced) {
      this.stop()
      for (const s of [this.sq, this.nod, this.leanS, this.tiltS, this.swayS]) s.x = s.v = 0
      if (this.current) for (const f of FACES) this.alpha[f] = f === this.current ? 1 : 0
      this.applyStatic()
    } else {
      this.ensureRunning()
    }
  }

  pulse() {
    if (this.reduced || this.destroyed) return
    this.nod.v = Math.min(this.nod.v + 8, 15) // 연타해도 끄덕임 속도는 상한이 있다
    this.ensureRunning()
  }

  destroy() {
    this.destroyed = true
    this.stop()
    document.removeEventListener('visibilitychange', this.onVisibility)
  }

  private readonly onVisibility = () => {
    if (document.hidden) this.stop()
    else this.ensureRunning()
  }

  private ensureRunning() {
    if (this.raf || this.reduced || this.destroyed || document.hidden) return
    this.last = 0
    this.raf = requestAnimationFrame(this.frame)
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private applyStatic() {
    this.body.style.transform = ''
    this.lastTransform = ''
    this.applyLayers()
    this.setBlink(false)
  }

  private applyLayers() {
    for (const f of FACES) {
      const a = this.alpha[f]
      if (a === this.shown[f]) continue
      this.shown[f] = a
      const el = this.layers[f]
      if (el) el.style.opacity = a <= 0.001 ? '0' : fmt(a)
    }
  }

  private setBlink(on: boolean) {
    if (on === this.blinkShown) return
    this.blinkShown = on
    if (this.blinkEl) this.blinkEl.style.opacity = on ? '1' : '0'
  }

  private readonly frame = (now: number) => {
    this.raf = 0
    if (this.destroyed || this.reduced || document.hidden) return
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.05) : 1 / 60
    this.last = now
    this.time += dt
    this.update(dt)
    this.render()
    this.raf = requestAnimationFrame(this.frame)
  }

  private update(dt: number) {
    const t = this.time
    const cur = this.current
    if (cur) {
      // 크로스페이드: 새 표정은 위에서 올라오고, 이전 표정은 새 표정이 거의 덮은 뒤 사라진다.
      // 도중에 다른 표정이 와도 각 레이어의 현재 불투명도에서 이어간다(올라가는 쪽은 현재 값에서 +, 내려가는 쪽은 min).
      this.alpha[cur] = Math.min(1, this.alpha[cur] + dt / FADE_SEC)
      const cap = clamp((1 - this.alpha[cur]) / 0.4, 0, 1)
      for (const f of FACES) if (f !== cur) this.alpha[f] = Math.min(this.alpha[f], cap)
      this.applyLayers()
    }

    let remaining = dt
    while (remaining > 1e-6) {
      const h = Math.min(SUBSTEP, remaining)
      remaining -= h
      stepSpring(this.sq, 0, 230, 0.32, h)
      stepSpring(this.nod, 0, 210, 0.45, h)
      stepSpring(this.leanS, this.lean ? 1 : 0, 60, 0.8, h)
      stepSpring(this.tiltS, this.tiltOn ? 1 : 0, 50, 0.7, h)
      stepSpring(this.swayS, this.swayOn ? 1 : 0, 20, 1, h)
    }
    this.sq.x = clamp(this.sq.x, -1.3, 1.3)
    this.nod.x = clamp(this.nod.x, -0.6, 1.8)

    // 눈 깜박임: 평온한 표정이 완전히 자리 잡았을 때만(다른 표정에서는 얼굴이 바뀌어 보인다)
    const settled = cur === 'neutral' && this.alpha.neutral > 0.99 && FACES.every((f) => f === 'neutral' || this.alpha[f] < 0.01)
    if (!settled) {
      this.blinkUntil = -1
      this.blinkNext = t + rand(2.5, 6)
      this.setBlink(false)
    } else if (this.blinkUntil >= 0) {
      if (t >= this.blinkUntil) {
        this.blinkUntil = -1
        this.blinkNext = t + rand(2.5, 6)
        this.setBlink(false)
      }
    } else if (t >= this.blinkNext) {
      this.blinkUntil = t + BLINK_SEC
      this.setBlink(true)
    }
  }

  private render() {
    const t = this.time
    const A = this.amp
    const breath = (1 + Math.sin((t * Math.PI * 2) / 3.6)) / 2 // 0..1, 아래쪽 기준 scaleY 1↔1.02
    const sway = this.swayS.x * Math.sin(t * 1.1)
    const swayX = this.swayS.x * Math.sin(t * 0.8 + 0.5)
    const rot = 2.2 * A * this.leanS.x + 4 * A * this.tiltS.x + 2.4 * A * sway
    const tx = 1.2 * swayX
    const ty = 0.8 * this.leanS.x + 1.4 * this.nod.x
    const lean = 1 + 0.02 * this.leanS.x
    const sx = lean * (1 + 0.07 * A * this.sq.x)
    const sy = lean * (1 + 0.02 * breath) * (1 - 0.09 * A * this.sq.x)
    const next = `translate(${fmt(tx)}%, ${fmt(ty)}%) rotate(${fmt(rot)}deg) scale(${fmt(sx)}, ${fmt(sy)})`
    if (next !== this.lastTransform) {
      this.lastTransform = next
      this.body.style.transform = next
    }
  }
}

function MascotView({ state, expression, intensity, typingPulse = 0, reducedMotion, label,
  skinDir = '/skins/bogeum', name = '보금이', credit = 'REAL RENT 오리지널 캐릭터 · AI 생성 시안', onSkinError,
}: MascotProps): JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null)
  const layerEls = useRef<FaceElements>({ neutral: null, excited: null, thinking: null, worried: null, surprised: null, sorry: null })
  const blinkRef = useRef<HTMLImageElement>(null)
  const rigRef = useRef<MascotRig | null>(null)
  const lastPulse = useRef(typingPulse)
  const prefersReduced = useSyncExternalStore(subscribeReduced, getReduced, () => false)
  const reduced = reducedMotion ?? prefersReduced
  const level = intensity ?? DEFAULT_INTENSITY[expression]

  useEffect(() => {
    const rig = new MascotRig(bodyRef.current!, layerEls.current, blinkRef.current)
    rigRef.current = rig
    return () => {
      rig.destroy()
      rigRef.current = null
    }
  }, [])

  // 모션 줄이기를 먼저 반영해야 첫 표정 배치와 이후 즉시 교체가 올바르다.
  useEffect(() => {
    rigRef.current?.setReducedMotion(reduced)
  }, [reduced])

  useEffect(() => {
    rigRef.current?.setTarget(state, expression, level)
  }, [state, expression, level, reduced])

  useEffect(() => {
    if (typingPulse > lastPulse.current) rigRef.current?.pulse()
    lastPulse.current = typingPulse
  }, [typingPulse])

  const shown = state === 'error' ? 'apologetic' : expression
  const ariaLabel = label ?? `${name}: ${EXPRESSION_LABELS[shown]}`

  return (
    <div className="mascot-wrap">
      <div
        className="mascot"
        role="img"
        aria-label={ariaLabel}
        data-state={state}
        data-expression={shown}
        data-face={resolveFace(state, expression)}
        data-reduced-motion={reduced ? 'true' : 'false'}
      >
        <div className="mascot-body" ref={bodyRef}>
          {FACES.map((f) => (
            <img
              key={f}
              ref={(el) => {
                layerEls.current[f] = el
              }}
              className="mascot-layer"
              data-face={f}
              src={`${skinDir}/${f}.png`}
              onError={() => onSkinError?.(`${f}.png: 이미지를 표시할 수 없어요`)}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
          ))}
          <img
            ref={blinkRef}
            className="mascot-layer"
            style={{ zIndex: BLINK_Z }}
            data-face="blink"
            src={`${skinDir}/blink.png`}
            onError={() => onSkinError?.('blink.png: 이미지를 표시할 수 없어요')}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
        </div>
      </div>
      <small className="mascot-credit">{credit}</small>
    </div>
  )
}

/** 이미지 7장을 마운트 시 미리 불러오고, 하나라도 실패하면 렌티로 대체한다. */
export function MascotCharacter({ skinDir = '/skins/bogeum', onSkinError, ...props }: MascotProps): JSX.Element {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const imgs = [...FACES, 'blink'].map((name) => {
      const img = new Image()
      img.onerror = () => {
        setFailed(true)
        onSkinError?.(`${name}.png: 이미지가 없거나 읽을 수 없어요`)
      }
      img.src = `${skinDir}/${name}.png`
      return img
    })
    return () => {
      for (const img of imgs) img.onerror = null
    }
  }, [skinDir, onSkinError])

  return failed ? <Renti {...props} /> : <MascotView {...props} skinDir={skinDir} onSkinError={onSkinError} />
}
