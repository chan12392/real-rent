// 대화 패널의 순수 상태 로직. 화면·네트워크에 의존하지 않아 node 로 바로 검사한다.
// (런타임 import 는 .ts 확장자를 붙이고, api 타입은 import type 만 쓴다.)
import type { CompareRequest, ConditionCandidate, ConditionQuestion, ParseResponse } from './api'
import { changeToForm } from './conditions.ts'
import type { Change } from './conditions.ts'
import { krw } from './format.ts'
import { RENTI } from './persona.ts'
import type { Persona, VoiceCue } from './persona.ts'

export type ExpressionId =
  | 'neutral'
  | 'listening'
  | 'thinking'
  | 'happy'
  | 'empathetic'
  | 'concerned'
  | 'surprised'
  | 'apologetic'
export type CharacterState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'reacting'
  | 'comparing'
  | 'result'
  | 'error'

export const EXPRESSION_IDS: readonly ExpressionId[] = [
  'neutral',
  'listening',
  'thinking',
  'happy',
  'empathetic',
  'concerned',
  'surprised',
  'apologetic',
]
/** 표정별 기본 강도 표 (캐릭터 컴포넌트의 DEFAULT_INTENSITY 를 주입받는다). */
export type IntensityTable = Readonly<Record<ExpressionId, number>>

export const LISTEN_IDLE_MS = 1200
/** 빠른 입력 칩. 누르면 입력창에 채우고 일반 전송과 같은 경로로 보낸다. */
export const QUICK_CHIPS = ['월세 60 이하로', '40분 안쪽', '환승 없이', '11월 1일 입주'] as const

/** 오류 표정이 대기로 돌아가기까지. */
export const SETTLE_MS = 2600
/** 의미 반응(reacting) 표정은 이 시간 이상 유지한 뒤 대기로 돌아간다. 결과(result) 표정은 다음 입력까지 유지. */
export const REACT_HOLD_MS = 3000
/** 반응 표정이 이만큼은 보인 뒤에야 새 입력(타이핑)이 듣기 표정으로 끊을 수 있다. */
export const LISTEN_INTERRUPT_MIN_MS = 1000
export const CONFIDENCE_MIN = 0.5

export function isExpressionId(value: unknown): value is ExpressionId {
  return typeof value === 'string' && (EXPRESSION_IDS as readonly string[]).includes(value)
}

/**
 * 서버 반응 → 표정. 강도는 표정별 기본값 표에서만 정한다(confidence 는 쓰지 않는다).
 * enum 밖, confidence 가 숫자가 아니거나 범위 밖, confidence < 0.5 이면 neutral.
 */
export function decideExpression(
  expressionId: unknown,
  confidence: unknown,
  table: IntensityTable,
): { expression: ExpressionId; intensity: number } {
  const neutral = { expression: 'neutral' as const, intensity: table.neutral }
  if (!isExpressionId(expressionId)) return neutral
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return neutral
  if (confidence < 0 || confidence > 1 || confidence < CONFIDENCE_MIN) return neutral
  return { expression: expressionId, intensity: table[expressionId] }
}

/** 비교 결과 → 표정. pass≥1 happy, pass 0 empathetic, 오류 apologetic. */
export type ResultKind = 'pass' | 'none' | 'error'
export function resultExpression(kind: ResultKind): ExpressionId {
  return kind === 'pass' ? 'happy' : kind === 'none' ? 'empathetic' : 'apologetic'
}
const RESULT_CUE: Record<ResultKind, VoiceCue> = { pass: 'result_pass', none: 'result_none', error: 'server_error' }

export function characterLabel(
  state: CharacterState,
  expression: ExpressionId,
  persona: Persona = RENTI,
): string {
  const base = persona.statusLabels
  const mood: Partial<Record<ExpressionId, string>> = {
    happy: '밝은 표정',
    empathetic: '공감하는 표정',
    concerned: '걱정하는 표정',
    surprised: '놀란 표정',
    apologetic: '미안해하는 표정',
  }
  const m = mood[expression]
  return m ? `${base[state]} (${m})` : base[state]
}

/* ───── 조건 후보 표시 ───── */

export const FIELD_LABEL: Record<string, string> = {
  deposit_limit_krw: '보증금 한도',
  monthly_budget_krw: '월 지출 한도',
  move_in_by: '입주 희망일',
  office_days: '월 출근일',
  max_one_way_minutes: '편도 최대 시간',
  max_transfers: '최대 환승',
  priority: '우선순위',
  stay_months: '거주 기간',
}

export function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return '미설정'
  switch (field) {
    case 'deposit_limit_krw':
    case 'monthly_budget_krw':
      return typeof value === 'number' ? krw(value) : String(value)
    case 'max_one_way_minutes':
      return `${value}분`
    case 'office_days':
      return `${value}일`
    case 'max_transfers':
      return `${value}회`
    case 'stay_months':
      return `${value}개월`
    case 'priority':
      return value === 'cost' ? '비용 먼저' : value === 'time' ? '시간 먼저' : String(value)
    default:
      return String(value)
  }
}

/* ───── 상태 ───── */

export type ChatMessage = {
  id: number
  role: 'lenti' | 'user'
  text: string
  /** 실패 안내 말풍선에서 같은 문장을 다시 보낼 때 쓴다. */
  retryText?: string
}

export type CandidateStatus = 'pending' | 'applied' | 'cancelled'
export type PendingCandidate = ConditionCandidate & { status: CandidateStatus }
export type PendingConditions = {
  requestId: string
  original: string
  candidates: PendingCandidate[]
  questions: ConditionQuestion[]
}

export type ChatState = {
  /** 대화 캐릭터의 이름·말투. 말풍선 문구는 모두 이 persona 를 거친다. */
  persona: Persona
  table: IntensityTable
  characterState: CharacterState
  expression: ExpressionId
  intensity: number
  typingPulse: number
  /** 반응 표정이 시작된 시각(ms, 주입된 시계 기준). 시각 없는 액션이면 null — 이때는 끊김 방지를 적용하지 않는다. */
  faceSince: number | null
  /** 표정이 바뀔 때마다 1씩 늘어난다. 복귀 타이머가 새 표정인지 알아보는 데 쓴다. */
  faceSeq: number
  messages: ChatMessage[]
  nextMsgId: number
  latestRequestId: string | null
  inflightText: string | null
  reactDone: boolean
  reactFailed: boolean
  parseDone: boolean
  parseFailed: boolean
  pending: PendingConditions | null
  comparing: boolean
  compareToken: number
  /** 대화 입력(submit)과 비교 시작(compareStart)에 함께 매기는 순번. 어느 쪽이 나중에 시작했는지 가린다. */
  order: number
  /** 최신 입력이 받은 순번. */
  inputOrder: number
  /** 최근 비교가 시작될 때 받은 순번. */
  compareOrder: number
  /** 지금까지 폼에 반영된 조건 수. 0이면 비교 버튼을 보이지 않는다. */
  appliedCount: number
}

export const GREETING = RENTI.greeting

export function createInitialState(table: IntensityTable, persona: Persona = RENTI): ChatState {
  return {
    persona,
    table,
    characterState: 'idle',
    expression: 'neutral',
    intensity: table.neutral,
    typingPulse: 0,
    faceSince: null,
    faceSeq: 0,
    messages: [{ id: 1, role: 'lenti', text: persona.greeting }],
    nextMsgId: 2,
    latestRequestId: null,
    inflightText: null,
    reactDone: true,
    reactFailed: false,
    parseDone: true,
    parseFailed: false,
    pending: null,
    comparing: false,
    compareToken: 0,
    order: 0,
    inputOrder: 0,
    compareOrder: 0,
    appliedCount: 0,
  }
}

export type ChatAction =
  | { type: 'typing'; at?: number }
  | { type: 'idleTimeout' }
  | { type: 'settle'; at?: number }
  | { type: 'submit'; requestId: string; text: string }
  | { type: 'reactOk'; requestId: string; expressionId: unknown; confidence: unknown; at?: number }
  | { type: 'reactFail'; requestId: string }
  | { type: 'parseOk'; requestId: string; response: ParseResponse }
  | { type: 'parseFail'; requestId: string }
  | { type: 'resolve'; index: number | 'all'; decision: 'apply' | 'cancel' }
  | { type: 'compareStart'; token: number }
  | { type: 'compareDone'; token: number; kind: ResultKind; text: string }
  | { type: 'compareAbort'; token: number }
  | { type: 'compareInvalid'; errors: string[] }

function say(state: ChatState, role: ChatMessage['role'], text: string, retryText?: string) {
  const message: ChatMessage = { id: state.nextMsgId, role, text }
  if (retryText) message.retryText = retryText
  return { messages: [...state.messages, message], nextMsgId: state.nextMsgId + 1 }
}

function setFace(state: ChatState, characterState: CharacterState, expression: ExpressionId) {
  return { characterState, expression, intensity: state.table[expression], faceSeq: state.faceSeq + 1 }
}

function holdMs(characterState: CharacterState): number {
  return characterState === 'reacting' ? REACT_HOLD_MS : SETTLE_MS
}

/**
 * 반응·오류 표정이 대기로 돌아가기까지 남은 시간(ms). 돌아갈 표정이 아니거나
 * 응답·비교 대기 중이면 null. since 는 그 표정이 처음 보인 시각.
 */
export function settleDelay(state: ChatState, since: number, now: number): number | null {
  if (state.inflightText !== null || state.comparing) return null
  if (state.characterState !== 'reacting' && state.characterState !== 'error') return null
  return Math.max(0, since + holdMs(state.characterState) - now)
}

export type FaceClock = {
  now: () => number
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

/**
 * 상태가 바뀔 때마다 sync 를 부르면 표정 복귀 타이머를 다시 맞춘다. 시계·타이머는 주입받는다.
 * 표정이 처음 보인 시각부터 최소 유지 시간을 센다(응답이 더 늦게 끝나도 그 시각은 유지).
 */
export function createSettler(clock: FaceClock, dispatch: (action: ChatAction) => void) {
  let handle: unknown
  let seenSeq = -1
  let since = 0
  const cancel = () => {
    if (handle !== undefined) clock.clearTimeout(handle)
    handle = undefined
  }
  return {
    sync(state: ChatState) {
      cancel()
      if (state.faceSeq !== seenSeq) {
        seenSeq = state.faceSeq
        since = clock.now()
      }
      const delay = settleDelay(state, since, clock.now())
      if (delay === null) return
      handle = clock.setTimeout(() => {
        handle = undefined
        dispatch({ type: 'settle', at: clock.now() })
      }, delay)
    },
    cancel,
  }
}

/** 응답이 최신 요청의 것이 아니면 모든 효과(표정·조건·말풍선)를 버린다. */
function isLatest(state: ChatState, requestId: string): boolean {
  return state.latestRequestId !== null && state.latestRequestId === requestId
}

/**
 * 입력의 응답이 표정을 바꿀 수 없는가. 비교 중이거나 이 입력보다 나중에 시작한 비교가 있으면
 * 비교·결과 표정이 우선한다(늦게 온 이전 입력의 응답이 결과 표정을 덮지 않는다).
 */
function faceLocked(state: ChatState): boolean {
  return state.comparing || state.compareOrder > state.inputOrder
}

/** react·parse 가 모두 끝나면 진행 중 표시를 거둔다. 표정이 잠겨 있으면 표정은 건드리지 않는다. */
function finish(state: ChatState): ChatState {
  if (!state.reactDone || !state.parseDone) return state
  const next = { ...state, inflightText: null }
  if (faceLocked(state)) return next
  if (state.reactFailed && state.parseFailed) {
    return { ...next, ...setFace(state, 'error', 'neutral') }
  }
  return next
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'typing': {
      // 서버 호출 없는 로컬 듣기 반응. 입력 중에도 대화 기록은 그대로 둔다.
      // 반응 표정이 1초도 보이기 전에는 끊지 않는다(공감 표정이 잠깐 나왔다 사라지는 것을 막는다).
      if (
        state.characterState === 'reacting' &&
        action.at !== undefined &&
        state.faceSince !== null &&
        action.at - state.faceSince < LISTEN_INTERRUPT_MIN_MS
      ) {
        return state
      }
      return {
        ...state,
        typingPulse: state.typingPulse + 1,
        faceSince: null,
        ...setFace(state, 'listening', 'listening'),
      }
    }
    case 'idleTimeout': {
      if (state.characterState !== 'listening') return state
      return { ...state, ...setFace(state, 'idle', 'neutral') }
    }
    case 'settle': {
      if (state.inflightText !== null || state.comparing) return state
      if (state.characterState !== 'reacting' && state.characterState !== 'error') return state
      // 최소 유지 시간은 복귀 타이머(createSettler)가 지킨다. 시각이 있으면 여기서도 한 번 더 확인한다.
      if (action.at !== undefined && state.faceSince !== null && state.characterState === 'reacting') {
        if (action.at - state.faceSince < REACT_HOLD_MS) return state
      }
      return { ...state, faceSince: null, ...setFace(state, 'idle', 'neutral') }
    }
    case 'submit': {
      const text = action.text.trim()
      if (!text) return state
      // 같은 문장이 아직 처리 중이면 중복 전송으로 보고 무시한다(실패 후에는 inflightText 가 비어 재전송 가능).
      if (state.inflightText === text) return state
      return {
        ...state,
        ...say(state, 'user', text),
        ...setFace(state, 'thinking', 'thinking'),
        order: state.order + 1,
        inputOrder: state.order + 1,
        latestRequestId: action.requestId,
        inflightText: text,
        reactDone: false,
        reactFailed: false,
        parseDone: false,
        parseFailed: false,
        pending: null,
        // 비교 중이면 비교 표정을 유지한다.
        ...(state.comparing ? { characterState: state.characterState } : {}),
      }
    }
    case 'reactOk': {
      if (!isLatest(state, action.requestId)) return state
      const face = decideExpression(action.expressionId, action.confidence, state.table)
      const base = { ...state, reactDone: true, reactFailed: false }
      if (faceLocked(state)) return finish(base)
      return finish({
        ...base,
        characterState: 'reacting',
        faceSince: action.at ?? null,
        faceSeq: state.faceSeq + 1,
        expression: face.expression,
        intensity: face.intensity,
      })
    }
    case 'reactFail': {
      // 표정 실패는 대화·비교와 독립이다. 조건 해석을 기다리지 않고 바로 neutral 로 복구하고 아무것도 막지 않는다.
      if (!isLatest(state, action.requestId)) return state
      const base = { ...state, reactDone: true, reactFailed: true }
      if (faceLocked(state)) return finish(base)
      return finish({ ...base, faceSince: null, ...setFace(state, 'idle', 'neutral') })
    }
    case 'parseOk': {
      if (!isLatest(state, action.requestId)) return state
      const { response } = action
      const { persona } = state
      const candidates: PendingCandidate[] = response.candidates
        .filter((c) => changeToForm({ field: c.field as Change['field'], value: c.value }) !== null)
        .map((c) => ({ ...c, status: 'pending' as const }))
      const original = state.inflightText ?? ''
      let next: ChatState = { ...state, parseDone: true, parseFailed: false }
      if (!response.understood || (candidates.length === 0 && response.questions.length === 0)) {
        next = {
          ...next,
          ...say(next, 'lenti', persona.voice(persona.lines.notUnderstood(original), 'not_understood')),
        }
        return finish(next)
      }
      if (candidates.length > 0) {
        next = {
          ...next,
          ...say(next, 'lenti', persona.voice(persona.lines.confirm, 'confirm')),
          pending: {
            requestId: action.requestId,
            original,
            candidates,
            questions: response.questions,
          },
        }
      }
      for (const q of response.questions) {
        const options = q.options.length > 0 ? ` (${q.options.join(' / ')})` : ''
        next = { ...next, ...say(next, 'lenti', persona.voice(`${q.question}${options}`, 'question')) }
      }
      return finish(next)
    }
    case 'parseFail': {
      if (!isLatest(state, action.requestId)) return state
      const original = state.inflightText ?? ''
      const next: ChatState = {
        ...state,
        parseDone: true,
        parseFailed: true,
        ...say(state, 'lenti', state.persona.voice(state.persona.lines.parseFail, 'server_error'), original),
      }
      return finish(next)
    }
    case 'resolve': {
      if (!state.pending) return state
      const picked = (i: number, c: PendingCandidate) =>
        c.status === 'pending' && (action.index === 'all' || action.index === i)
      const hit = state.pending.candidates.filter((c, i) => picked(i, c))
      if (hit.length === 0) return state
      const status: CandidateStatus = action.decision === 'apply' ? 'applied' : 'cancelled'
      const candidates = state.pending.candidates.map((c, i) => (picked(i, c) ? { ...c, status } : c))
      const names = hit.map((c) => FIELD_LABEL[c.field] ?? c.field).join(', ')
      const { persona } = state
      const text =
        action.decision === 'apply'
          ? persona.voice(persona.lines.applied(names), 'applied')
          : persona.voice(persona.lines.cancelled(names), 'cancel')
      return {
        ...state,
        ...say(state, 'lenti', text),
        pending: { ...state.pending, candidates },
        appliedCount: state.appliedCount + (action.decision === 'apply' ? hit.length : 0),
      }
    }
    case 'compareStart': {
      return {
        ...state,
        comparing: true,
        compareToken: action.token,
        order: state.order + 1,
        compareOrder: state.order + 1,
        ...setFace(state, 'comparing', 'thinking'),
      }
    }
    case 'compareDone': {
      // 더 새로운 비교가 시작됐으면 이 결과는 버린다.
      if (action.token !== state.compareToken) return state
      return {
        ...state,
        comparing: false,
        ...say(state, 'lenti', state.persona.voice(action.text, RESULT_CUE[action.kind])),
        ...setFace(state, action.kind === 'error' ? 'error' : 'result', resultExpression(action.kind)),
      }
    }
    case 'compareAbort': {
      // 비교 응답이 다른 경로(왼쪽 폼)의 더 새로운 비교에 밀렸다. 대기 표시만 거둔다.
      if (action.token !== state.compareToken) return state
      return { ...state, comparing: false, ...setFace(state, 'idle', 'neutral') }
    }
    case 'compareInvalid': {
      return {
        ...state,
        ...say(state, 'lenti', state.persona.voice(state.persona.lines.invalid(action.errors), 'not_understood')),
      }
    }
  }
}

/** 지금 반영 대기 중인 후보를 폼 변경으로 바꾼다. index 를 생략하면 전부. 취소된 것은 제외. */
export function changesFor(pending: PendingConditions | null, index: number | 'all'): Change[] {
  if (!pending) return []
  return pending.candidates
    .filter((c, i) => c.status === 'pending' && (index === 'all' || index === i))
    .map((c) => ({ field: c.field as Change['field'], value: c.value }))
}

/** 확인 카드의 “현재값” 표시용. 현재 요청이 없으면 미설정. */
export function currentValueOf(current: CompareRequest | undefined, field: string): unknown {
  if (!current) return undefined
  return (current as unknown as Record<string, unknown>)[field]
}
