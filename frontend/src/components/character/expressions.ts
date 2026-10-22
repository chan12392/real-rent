// 렌티 표정 사전: 연속 파라미터(Pose)와 표정·상태별 목표값.
// 표정은 중립 자세에서 표정 자세로 intensity만큼 선형 보간해 만든다(이미지 교체 없음).

export type ExpressionId =
  | 'neutral'
  | 'listening'
  | 'thinking'
  | 'happy'
  | 'empathetic'
  | 'concerned'
  | 'surprised'
  | 'apologetic'

export type CharacterState = 'idle' | 'listening' | 'thinking' | 'reacting' | 'comparing' | 'result' | 'error'

export const EXPRESSIONS: readonly ExpressionId[] = [
  'neutral',
  'listening',
  'thinking',
  'happy',
  'empathetic',
  'concerned',
  'surprised',
  'apologetic',
]

export const CHARACTER_STATES: readonly CharacterState[] = [
  'idle',
  'listening',
  'thinking',
  'reacting',
  'comparing',
  'result',
  'error',
]

/** 표정별 기본 강도(0..1). 응답 confidence와 무관하다. */
export const DEFAULT_INTENSITY: Record<ExpressionId, number> = {
  neutral: 1,
  listening: 0.7,
  thinking: 0.8,
  happy: 0.8,
  empathetic: 0.75,
  concerned: 0.65,
  surprised: 0.75,
  apologetic: 0.8,
}

export const EXPRESSION_LABELS: Record<ExpressionId, string> = {
  neutral: '평온한 표정',
  listening: '귀 기울여 듣는 표정',
  thinking: '생각하는 표정',
  happy: '기뻐하는 표정',
  empathetic: '공감하는 표정',
  concerned: '걱정하는 표정',
  surprised: '놀란 표정',
  apologetic: '미안해하는 표정',
}

/** 리그의 연속 파라미터. 단위: 각도는 도, 위치는 SVG px, 나머지는 대략 -1..1 또는 0..1. */
export interface Pose {
  headTilt: number // 고개 기울기(도, +는 시계 방향)
  headLift: number // 고개 높이(px, -는 위로)
  lean: number // 앞으로 다가오는 정도(추가 배율)
  gazeX: number // 시선 좌우 -1..1
  gazeY: number // 시선 상하 -1(위)..1(아래)
  eyeOpen: number // 눈 뜬 정도(1이 기본)
  eyeSmile: number // +는 웃는 눈(^), -는 아래로 굽은 감은 눈(∪) -1..1
  browLift: number // 눈썹 높이(px, +는 위로)
  browInner: number // 눈썹 안쪽 끝 들림 -1..1(+는 걱정·미안)
  browAsym: number // 오른쪽 눈썹만 추가로 올림(px)
  mouthCurve: number // 입꼬리 -1(내려감)..1(웃음)
  mouthOpen: number // 입 벌림 0..1
  mouthWidth: number // 입 너비 배율
  mouthShift: number // 입 좌우 이동(px)
  blush: number // 볼 홍조 0..1
  sweat: number // 땀방울 0..1
  thought: number // 생각 표시(굴뚝 위 점 3개, 다락 창 불빛) 0..1
  sparkle: number // 반짝임 0..1
  roofLift: number // 지붕이 들썩이는 높이(px)
}

export type PoseKey = keyof Pose

export const NEUTRAL_POSE: Pose = {
  headTilt: 0,
  headLift: 0,
  lean: 0,
  gazeX: 0,
  gazeY: 0,
  eyeOpen: 1,
  eyeSmile: 0.08,
  browLift: 0,
  browInner: 0,
  browAsym: 0,
  mouthCurve: 0.35,
  mouthOpen: 0,
  mouthWidth: 0.8,
  mouthShift: 0,
  blush: 0.25,
  sweat: 0,
  thought: 0,
  sparkle: 0,
  roofLift: 0,
}

export const POSE_KEYS = Object.keys(NEUTRAL_POSE) as PoseKey[]

/** intensity = 1 일 때의 표정 자세. 적지 않은 값은 중립 그대로다. */
const EXPRESSION_POSES: Record<ExpressionId, Partial<Pose>> = {
  neutral: {},
  listening: {
    headTilt: 7,
    headLift: -2,
    lean: 0.035,
    gazeX: -0.15,
    gazeY: 0.1,
    eyeOpen: 1.12,
    eyeSmile: 0,
    browLift: 3,
    browInner: 0.15,
    mouthCurve: 0.3,
    mouthOpen: 0.14,
    mouthWidth: 0.5,
    blush: 0.3,
  },
  thinking: {
    headTilt: -8,
    gazeX: 0.55,
    gazeY: -0.75,
    eyeOpen: 0.9,
    eyeSmile: 0,
    browLift: 1,
    browInner: -0.15,
    browAsym: 4,
    mouthCurve: -0.08,
    mouthWidth: 0.5,
    mouthShift: 8,
    thought: 1,
  },
  happy: {
    headTilt: 4,
    headLift: -5,
    eyeSmile: 1,
    browLift: 4,
    mouthCurve: 1,
    mouthOpen: 0.55,
    mouthWidth: 1.1,
    blush: 1,
    sparkle: 1,
    roofLift: 3,
  },
  empathetic: {
    headTilt: 11,
    headLift: 1,
    lean: 0.02,
    gazeY: 0.1,
    eyeOpen: 1,
    eyeSmile: 0.18,
    browLift: 2,
    browInner: 0.55,
    mouthCurve: 0.5,
    mouthWidth: 0.75,
    blush: 0.7,
  },
  concerned: {
    headTilt: -4,
    headLift: 2,
    gazeX: 0.1,
    gazeY: 0.3,
    eyeOpen: 0.95,
    eyeSmile: 0,
    browLift: -1,
    browInner: 0.8,
    mouthCurve: -0.55,
    mouthOpen: 0.05,
    mouthWidth: 0.6,
    blush: 0.12,
    sweat: 0.55,
  },
  surprised: {
    headLift: -7,
    lean: 0.04,
    eyeOpen: 1.38,
    eyeSmile: 0,
    browLift: 8,
    browInner: 0.2,
    mouthCurve: 0,
    mouthOpen: 0.9,
    mouthWidth: 0.45,
    blush: 0.2,
    roofLift: 8,
  },
  apologetic: {
    headTilt: -12,
    headLift: 7,
    gazeX: -0.2,
    gazeY: 0.7,
    eyeOpen: 0.75,
    eyeSmile: -1,
    browLift: 1,
    browInner: 1.1,
    mouthCurve: -0.45,
    mouthOpen: 0.06,
    mouthWidth: 0.5,
    blush: 0.45,
    sweat: 1,
  },
}

/** 상태가 표정 위에 덧씌우는 값: [목표값, 가중치 0..1]. */
const STATE_OVERLAYS: Partial<Record<CharacterState, Partial<Record<PoseKey, readonly [number, number]>>>> = {
  listening: { lean: [0.03, 0.5], gazeY: [0.2, 0.4], eyeOpen: [1.08, 0.4] },
  thinking: { gazeX: [0.5, 0.75], gazeY: [-0.8, 0.85], browAsym: [3.5, 0.6], thought: [1, 1] },
  comparing: { gazeY: [-0.55, 0.8], browLift: [2, 0.5], thought: [1, 1] },
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 상태·표정·강도에서 목표 자세를 계산한다. error 상태는 apologetic을 기반으로 한다. */
export function resolvePose(state: CharacterState, expression: ExpressionId, intensity?: number): Pose {
  const expr: ExpressionId = state === 'error' ? 'apologetic' : expression
  const raw = intensity ?? DEFAULT_INTENSITY[expr]
  const k = clamp(Number.isFinite(raw) ? raw : DEFAULT_INTENSITY[expr], 0, 1)
  const full = EXPRESSION_POSES[expr] ?? {}
  const pose = { ...NEUTRAL_POSE }
  for (const key of POSE_KEYS) {
    const to = full[key]
    if (to !== undefined) pose[key] = NEUTRAL_POSE[key] + (to - NEUTRAL_POSE[key]) * k
  }
  const overlay = STATE_OVERLAYS[state]
  if (overlay) {
    for (const key of POSE_KEYS) {
      const entry = overlay[key]
      if (entry) pose[key] += (entry[0] - pose[key]) * entry[1]
    }
  }
  return pose
}
