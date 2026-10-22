// 렌티 애니메이션 리그.
// React 렌더 없이 requestAnimationFrame에서 SVG 속성을 직접 갱신한다.
// 각 파라미터는 스프링(위치+속도)이라 전환 도중 새 목표가 와도 현재 자세·속도에서 이어간다.

import { clamp, NEUTRAL_POSE, POSE_KEYS, resolvePose, type CharacterState, type ExpressionId, type Pose, type PoseKey } from './expressions'

// 얼굴 기준 좌표(SVG viewBox 단위)
const EYE_L = { x: 78, y: 122 }
const EYE_R = { x: 122, y: 122 }
const EYE_W = 8.5
const EYE_H = 10.5
const BROW_Y = 107
const MOUTH = { x: 100, y: 145 }
const PIVOT = { x: 100, y: 156 } // 고개 회전 중심(목)

type SpringGroup = 'head' | 'gaze' | 'face'
const GROUP: Partial<Record<PoseKey, SpringGroup>> = {
  headTilt: 'head',
  headLift: 'head',
  lean: 'head',
  roofLift: 'head',
  gazeX: 'gaze',
  gazeY: 'gaze',
}
// k: 강성, z: 감쇠비. 감쇠비 < 1 이라 살짝 넘쳤다가 자리 잡는다.
const SPRING: Record<SpringGroup, { k: number; z: number }> = {
  head: { k: 110, z: 0.62 },
  gaze: { k: 260, z: 0.85 },
  face: { k: 190, z: 0.78 },
}
const SUBSTEP = 1 / 120

export interface Spring {
  x: number
  v: number
}

export function stepSpring(s: Spring, target: number, k: number, z: number, dt: number) {
  const a = k * (target - s.x) - 2 * Math.sqrt(k) * z * s.v
  s.v += a * dt
  s.x += s.v * dt
}

const f = (n: number) => (Math.abs(n) < 1e-4 ? '0' : n.toFixed(2))
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo)

/** 눈 모양: 위·아래 3차 곡선. smile > 0 이면 아래 곡선이 올라가 웃는 눈(^),
 *  smile < 0 이면 위 곡선이 내려가 아래로 굽은 감은 눈(∪)이 된다. */
function eyePath(cx: number, cy: number, open: number, smile: number) {
  const h = EYE_H * Math.max(0, open)
  const top = cy - (4 / 3) * h * (1 + 1.75 * Math.min(smile, 0))
  const bottom = cy + (4 / 3) * h * (1 - 1.75 * Math.max(smile, 0))
  const l = cx - EYE_W
  const r = cx + EYE_W
  return `M${f(l)} ${f(cy)}C${f(l)} ${f(top)} ${f(r)} ${f(top)} ${f(r)} ${f(cy)}C${f(r)} ${f(bottom)} ${f(l)} ${f(bottom)} ${f(l)} ${f(cy)}Z`
}

/** 눈썹: 안쪽 끝(inner)이 얼굴 가운데 쪽. side = -1(왼쪽 눈썹) | 1(오른쪽 눈썹). */
function browPath(cx: number, y: number, side: -1 | 1, inner: number) {
  const innerX = cx - side * 8
  const outerX = cx + side * 8
  const innerY = y - inner * 5
  const outerY = y + inner * 1.5
  const midY = (innerY + outerY) / 2 - 3
  return `M${f(outerX)} ${f(outerY)}Q${f(cx)} ${f(midY)} ${f(innerX)} ${f(innerY)}`
}

function mouthPath(p: Pose) {
  const curve = clamp(p.mouthCurve, -1.2, 1.2)
  const open = clamp(p.mouthOpen, 0, 1.2)
  const w = 13 * clamp(p.mouthWidth, 0.25, 1.4)
  const cx = MOUTH.x + p.mouthShift
  const cornerY = MOUTH.y - curve * 5
  const upper = MOUTH.y + curve * 6 - open * 8 * (1 - Math.max(curve, 0))
  const lower = MOUTH.y + curve * 6 + open * 20
  return `M${f(cx - w)} ${f(cornerY)}Q${f(cx)} ${f(upper)} ${f(cx + w)} ${f(cornerY)}Q${f(cx)} ${f(lower)} ${f(cx - w)} ${f(cornerY)}Z`
}

type PartName =
  | 'shadow'
  | 'body'
  | 'head'
  | 'roof'
  | 'glow'
  | 'features'
  | 'eyeL'
  | 'eyeR'
  | 'shineL'
  | 'shineR'
  | 'browL'
  | 'browR'
  | 'cheekL'
  | 'cheekR'
  | 'mouth'
  | 'sweat'
  | 'sparkleA'
  | 'sparkleB'
  | 'dot0'
  | 'dot1'
  | 'dot2'

const PART_NAMES: readonly PartName[] = [
  'shadow', 'body', 'head', 'roof', 'glow', 'features', 'eyeL', 'eyeR', 'shineL', 'shineR',
  'browL', 'browR', 'cheekL', 'cheekR', 'mouth', 'sweat', 'sparkleA', 'sparkleB', 'dot0', 'dot1', 'dot2',
]

export class CharacterRig {
  private readonly parts: Partial<Record<PartName, SVGElement>> = {}
  private readonly springs = {} as Record<PoseKey, Spring>
  private target: Pose = { ...NEUTRAL_POSE }
  private state: CharacterState = 'idle'
  private initialized = false
  private reduced = false
  private destroyed = false
  private raf = 0
  private last = 0
  private time = 0

  // 기본 움직임
  private blinkNext = rand(2.5, 6)
  private blinkStart = -1
  private blinkAgain = false
  private readonly saccade = { x: { x: 0, v: 0 }, y: { x: 0, v: 0 }, tx: 0, ty: 0, next: rand(1.5, 3.5) }
  private readonly nod: Spring = { x: 0, v: 0 }
  private typingUntil = -1
  private typingGaze = 0
  private scanSide = 1
  private scanNext = 0

  constructor(svg: SVGSVGElement) {
    for (const name of PART_NAMES) {
      const el = svg.querySelector<SVGElement>(`[data-part="${name}"]`)
      if (el) this.parts[name] = el
    }
    for (const key of POSE_KEYS) this.springs[key] = { x: NEUTRAL_POSE[key], v: 0 }
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  setTarget(state: CharacterState, expression: ExpressionId, intensity?: number) {
    this.state = state
    this.target = resolvePose(state, expression, intensity)
    if (!this.initialized || this.reduced) {
      // 첫 표시와 모션 줄이기 모드는 바로 목표 자세로 둔다.
      this.initialized = true
      this.snap()
      return
    }
    this.ensureRunning()
  }

  setReducedMotion(reduced: boolean) {
    this.reduced = reduced
    if (reduced) {
      this.stop()
      this.nod.x = this.nod.v = 0
      this.saccade.x.x = this.saccade.y.x = this.saccade.x.v = this.saccade.y.v = 0
      this.blinkStart = -1
      this.snap()
    } else {
      this.ensureRunning()
    }
  }

  /** 키 입력 1회: 작은 끄덕임과 시선 이동. 표정은 다시 시작하지 않는다. */
  pulse() {
    if (this.reduced || this.destroyed) return
    this.nod.v = Math.min(this.nod.v + 26, 48) // 연타해도 끄덕임 속도는 상한이 있다
    this.typingUntil = this.time + 0.7
    this.typingGaze = clamp(this.typingGaze + rand(-0.08, 0.08), -0.18, 0.18)
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

  private snap() {
    for (const key of POSE_KEYS) {
      this.springs[key].x = this.target[key]
      this.springs[key].v = 0
    }
    this.render(false)
  }

  private readonly frame = (now: number) => {
    this.raf = 0
    if (this.destroyed || this.reduced || document.hidden) return
    // 탭 복귀·첫 프레임에서 큰 dt로 튀지 않게 제한한다.
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.05) : 1 / 60
    this.last = now
    this.time += dt
    this.update(dt)
    this.render(true)
    this.raf = requestAnimationFrame(this.frame)
  }

  private update(dt: number) {
    const t = this.time
    // 시선 미세 이동(사카드)과 비교 중 좌우 훑기
    if (this.state === 'comparing') {
      if (t >= this.scanNext) {
        this.scanSide = -this.scanSide
        this.saccade.tx = 0.55 * this.scanSide
        this.saccade.ty = rand(-0.08, 0.08)
        this.scanNext = t + rand(0.9, 1.3)
      }
    } else if (t >= this.saccade.next) {
      const amp = this.state === 'thinking' ? 0.2 : 0.12
      this.saccade.tx = rand(-amp, amp)
      this.saccade.ty = rand(-amp * 0.6, amp * 0.6)
      this.saccade.next = t + rand(1.4, 3.6)
    }
    let gazeTx = this.saccade.tx
    let gazeTy = this.saccade.ty
    if (t < this.typingUntil) {
      // 입력 중: 입력창(아래) 쪽을 살짝 보며 글자를 따라 시선이 조금씩 움직인다.
      gazeTx = this.typingGaze
      gazeTy = 0.22
    }
    if (this.state !== 'comparing' && t >= this.typingUntil) this.typingGaze *= 0.9

    let remaining = dt
    while (remaining > 1e-6) {
      const h = Math.min(SUBSTEP, remaining)
      remaining -= h
      for (const key of POSE_KEYS) {
        const { k, z } = SPRING[GROUP[key] ?? 'face']
        stepSpring(this.springs[key], this.target[key], k, z, h)
      }
      stepSpring(this.saccade.x, gazeTx, 320, 0.9, h)
      stepSpring(this.saccade.y, gazeTy, 320, 0.9, h)
      stepSpring(this.nod, 0, 210, 0.45, h)
    }
    this.nod.x = clamp(this.nod.x, -1.5, 4)

    // 눈 깜박임: 2.5~6초 간격, 가끔 두 번
    if (this.blinkStart < 0 && t >= this.blinkNext) {
      this.blinkStart = t
    }
    if (this.blinkStart >= 0 && t - this.blinkStart > 0.16) {
      this.blinkStart = -1
      if (!this.blinkAgain && Math.random() < 0.18) {
        this.blinkAgain = true
        this.blinkNext = t + 0.12
      } else {
        this.blinkAgain = false
        this.blinkNext = t + rand(2.5, 6)
      }
    }
  }

  private render(animated: boolean) {
    const p = {} as Pose
    for (const key of POSE_KEYS) p[key] = this.springs[key].x
    const t = this.time
    const P = this.parts

    // 기본 움직임 합성(모션 줄이기면 0)
    const breath = animated ? Math.sin((t * Math.PI * 2) / 3.6) : 0
    const sway = animated ? 1.3 * Math.sin(t * 0.9) + 0.6 * Math.sin(t * 0.37 + 1) : 0
    const drift = animated ? 0.8 * Math.sin(t * 0.5) : 0
    const nod = animated ? this.nod.x : 0
    const sx = animated ? this.saccade.x.x : 0
    const sy = animated ? this.saccade.y.x : 0
    let blink = 1
    if (animated && this.blinkStart >= 0) {
      const u = (t - this.blinkStart) / 0.16
      blink = 1 - Math.sin(Math.PI * clamp(u, 0, 1)) * 0.95
    }

    const gx = clamp(p.gazeX + sx, -1, 1)
    const gy = clamp(p.gazeY + sy, -1, 1)
    const tilt = p.headTilt + sway
    const lift = p.headLift - breath * 0.9 + nod
    const scale = 1 + clamp(p.lean, -0.05, 0.08)

    P.head?.setAttribute(
      'transform',
      `translate(${f(drift)} ${f(lift)}) rotate(${f(tilt)} ${PIVOT.x} ${PIVOT.y}) translate(${PIVOT.x} ${PIVOT.y}) scale(${f(scale)}) translate(${-PIVOT.x} ${-PIVOT.y})`,
    )
    P.body?.setAttribute('transform', `translate(100 206) scale(${f(1 + breath * 0.008)} ${f(1 + breath * 0.022)}) translate(-100 -206)`)
    P.shadow?.setAttribute('transform', `translate(100 211) scale(${f(1 + (lift - p.roofLift * 0.2) * 0.008)} 1) translate(-100 -211)`)
    P.roof?.setAttribute('transform', `translate(0 ${f(-Math.max(0, p.roofLift))})`)

    // 얼굴 요소 전체가 시선·끄덕임 방향으로 조금 움직여 입체감을 준다.
    P.features?.setAttribute('transform', `translate(${f(gx * 2.6)} ${f(gy * 2 + nod * 0.5)})`)

    const open = clamp(p.eyeOpen, 0, 1.5) * blink
    const smile = clamp(p.eyeSmile, -1, 1)
    const ex = gx * 2.4
    const ey = gy * 2.2
    P.eyeL?.setAttribute('d', eyePath(EYE_L.x + ex, EYE_L.y + ey, open, smile))
    P.eyeR?.setAttribute('d', eyePath(EYE_R.x + ex, EYE_R.y + ey, open, smile))
    const shine = clamp((open - 0.35) * 2, 0, 1) * clamp(1 - Math.abs(smile) * 1.6, 0, 1)
    for (const [el, eye] of [
      [P.shineL, EYE_L],
      [P.shineR, EYE_R],
    ] as const) {
      if (!el) continue
      el.setAttribute('cx', f(eye.x + ex + 2.6 + gx * 1.2))
      el.setAttribute('cy', f(eye.y + ey - 3.6 * Math.min(open, 1.3) + gy * 1.2))
      el.setAttribute('opacity', f(shine))
    }

    const browBase = BROW_Y - p.browLift + ey * 0.4
    const inner = clamp(p.browInner, -1, 1.2)
    P.browL?.setAttribute('d', browPath(EYE_L.x + ex * 0.6, browBase, -1, inner))
    P.browR?.setAttribute('d', browPath(EYE_R.x + ex * 0.6, browBase - p.browAsym, 1, inner))

    const blush = clamp(p.blush, 0, 1)
    for (const el of [P.cheekL, P.cheekR]) {
      if (!el) continue
      el.setAttribute('opacity', f(blush * 0.8))
      el.setAttribute('rx', f(7.5 + blush * 2.5))
    }

    P.mouth?.setAttribute('d', mouthPath(p))

    const sweat = clamp(p.sweat, 0, 1)
    P.sweat?.setAttribute('opacity', f(sweat))
    P.sweat?.setAttribute('transform', `translate(155 ${f(104 + (1 - sweat) * -5 + (animated ? Math.sin(t * 2.2) * 0.8 : 0))}) scale(${f(0.4 + sweat * 0.6)})`)

    const sparkle = clamp(p.sparkle, 0, 1)
    const tw = animated ? Math.sin(t * 5) : 0
    P.sparkleA?.setAttribute('opacity', f(sparkle))
    P.sparkleA?.setAttribute('transform', `translate(30 64) rotate(${f(tw * 12)}) scale(${f(sparkle * (0.85 + tw * 0.15))})`)
    P.sparkleB?.setAttribute('opacity', f(sparkle))
    P.sparkleB?.setAttribute('transform', `translate(172 58) rotate(${f(-tw * 12)}) scale(${f(sparkle * (0.7 - tw * 0.12))})`)

    // 생각 표시: 굴뚝 위 점 3개가 차례로 떠오르고, 다락 창에 불이 켜진다.
    const thought = clamp(p.thought, 0, 1)
    P.glow?.setAttribute('opacity', f(thought * (animated ? 0.7 + 0.3 * Math.sin(t * 3) : 1)))
    const dots = [P.dot0, P.dot1, P.dot2]
    dots.forEach((el, i) => {
      if (!el) return
      const phase = animated ? (Math.sin(t * 4 - i * 0.9) + 1) / 2 : 1
      el.setAttribute('opacity', f(thought * (0.35 + 0.65 * phase)))
      el.setAttribute('transform', `translate(0 ${f(animated ? -phase * 2.5 : 0)})`)
    })
  }
}
