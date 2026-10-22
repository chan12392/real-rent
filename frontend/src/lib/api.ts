export type HealthResponse = {
  status: 'ok'
  service: 'real-rent-api'
}

export type Status = 'pass' | 'fail' | 'unknown' | 'route_failed'
export type Priority = 'cost' | 'time'
export type AskStatus = 'answered' | 'unknown' | 'clarify' | 'out_of_scope'

export type Leg = {
  minutes: number
  fare_krw: number
  transfers: number
  walk_minutes: number
}

export type Listing = {
  listing_id: string
  label: string
  gu: string
  dong: string
  deposit_krw: number
  monthly_rent_krw: number
  monthly_management_krw: number | null
  management_includes: string[]
  move_in_available: string
  lat: number
  lng: number
  outbound: Leg | null
  return: Leg | null
}

export type ListingsResponse = {
  synthetic: true
  price_basis: string
  listings: Listing[]
}

export type CompareRequest = {
  deposit_limit_krw: number
  monthly_budget_krw: number
  move_in_by: string
  office_days: number
  max_one_way_minutes: number
  max_transfers: number
  priority: Priority
  stay_months: number
  management_overrides?: Record<string, number>
  /** 참고용 생활 조건(팀 미합의 시안). 생략하면 서버 기본값으로 계산한다. */
  living?: LivingRequest
}

export type Heating = 'individual_gas' | 'central' | 'electric'

export type LivingRequest = {
  persons?: number
  heating?: Heating
  move_in_month?: number | null
  include_economic?: boolean
}

export type Cost = {
  deposit_krw: number
  monthly_rent_krw: number
  monthly_management_krw: number | null
  monthly_commute_krw: number | null
  monthly_total_krw: number | null
  initial_cash_krw: number
  stay_total_krw: number | null
}

export type Scores = {
  cost: number | null
  time: number | null
  convenience: number | null
  livability: number | null
}

export type LivingAmount = {
  amount_krw: number | null
  low_krw: number | null
  high_krw: number | null
  estimated_share_pct: number | null
}

export type LivingItem = {
  key: string
  label: string
  monthly_krw: number | null
  one_time_krw: number | null
  low_krw: number | null
  high_krw: number | null
  basis: string
  note: string
  estimated: boolean
}

export type LivingPeak = { month: number; amount_krw: number }

/** 참고용 “진짜 월 거주비”(시안). 판정·순위에는 쓰지 않는다. 옛 서버 응답에는 없을 수 있다. */
export type LivingCost = {
  cash_monthly: LivingAmount
  economic_monthly: LivingAmount
  initial_cash: LivingAmount
  items: LivingItem[]
  peak: { electricity?: LivingPeak | null; gas?: LivingPeak | null }
  management_estimated: boolean
  parameter_status: Record<string, string>
}

export type CompareResult = {
  listing_id: string
  label: string
  gu: string
  dong: string
  status: Status
  primary_reason: string | null
  reasons: string[]
  rank: number | null
  management_overridden: boolean
  cost: Cost
  commute: {
    outbound: Leg | null
    return: Leg | null
    round_trip_minutes: number | null
  }
  scores: Scores
  living_cost?: LivingCost | null
}

export type CompareResponse = {
  synthetic: true
  conditions: CompareRequest
  assumptions: string[]
  counts: Record<Status, number>
  recommended: string[]
  results: CompareResult[]
}

export type Citation = { doc_id: string; quote: string }

export type AskResponse = {
  synthetic: true
  status: AskStatus
  answer: string
  citations: Citation[]
  candidates: string[]
}

/** 화면에서 오류 종류별로 다른 안내를 보여 주기 위한 오류. */
export class ApiError extends Error {
  readonly kind: 'network' | 'timeout' | 'validation' | 'server' | 'contract'
  readonly detail?: string[]

  constructor(kind: ApiError['kind'], message: string, detail?: string[]) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.detail = detail
  }
}

const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
const TIMEOUT_MS = 8000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validationDetail(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.detail)) return []
  return body.detail.map((item) => {
    if (!isRecord(item)) return String(item)
    const loc = Array.isArray(item.loc) ? item.loc.filter((p) => p !== 'body').join('.') : ''
    const msg = typeof item.msg === 'string' ? item.msg : '값이 올바르지 않습니다.'
    return loc ? `${loc}: ${msg}` : msg
  })
}

async function request(
  path: string,
  init?: RequestInit,
  timeoutMs: number = TIMEOUT_MS,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ApiError('timeout', '서버 응답이 늦어 중단했습니다. 잠시 뒤 다시 시도해 주세요.')
    }
    throw new ApiError(
      'network',
      '서버에 연결할 수 없습니다. 서버 실행 상태와 연결 설정을 확인해 주세요.',
    )
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (response.status === 422) {
    throw new ApiError('validation', '입력값이 올바르지 않습니다.', validationDetail(body))
  }
  if ([502, 503, 504].includes(response.status)) {
    throw new ApiError(
      'network',
      '서버에 연결할 수 없습니다. 서버 실행 상태와 연결 설정을 확인해 주세요.',
    )
  }
  if (!response.ok) {
    throw new ApiError('server', `서버가 오류를 반환했습니다. (HTTP ${response.status})`)
  }
  if (body === null) {
    throw new ApiError('contract', '서버 응답이 연결 규약과 다릅니다.')
  }
  return body
}

function post(path: string, payload: unknown, timeoutMs?: number): Promise<unknown> {
  return request(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    timeoutMs,
  )
}

function contractError(): ApiError {
  return new ApiError('contract', '서버 응답이 연결 규약과 다릅니다.')
}

export async function getHealth(): Promise<HealthResponse> {
  const data = await request('/health')
  if (!isRecord(data) || data.status !== 'ok' || data.service !== 'real-rent-api') {
    throw contractError()
  }
  return { status: 'ok', service: 'real-rent-api' }
}

export async function getListings(): Promise<ListingsResponse> {
  const data = await request('/listings')
  if (!isRecord(data) || !Array.isArray(data.listings)) throw contractError()
  return data as ListingsResponse
}

export async function compare(req: CompareRequest): Promise<CompareResponse> {
  const data = await post('/compare', req)
  if (
    !isRecord(data) ||
    !Array.isArray(data.results) ||
    !Array.isArray(data.assumptions) ||
    !isRecord(data.counts)
  ) {
    throw contractError()
  }
  return data as CompareResponse
}

export async function ask(question: string, listingId: string | null): Promise<AskResponse> {
  const data = await post('/ask', { question, listing_id: listingId })
  if (!isRecord(data) || typeof data.status !== 'string' || typeof data.answer !== 'string') {
    throw contractError()
  }
  return data as AskResponse
}

/* ───── 대화 입력 (docs/chat-character.md 계약) ───── */

export type ReactPhase = 'input' | 'confirm' | 'result'

export type ReactResponse = {
  synthetic: true
  assumptions: string[]
  request_id: string
  /** enum 검증은 화면(lib/chat.ts)이 한다. 서버가 목록 밖 값을 주어도 여기서 던지지 않는다. */
  expression_id: string
  /** 의미 분류 확신도 0..1. 표정 강도가 아니다. */
  confidence: number
  intent: string
  engine: string
}

export type ConditionCandidate = {
  field: string
  value: unknown
  display: string
  source_text: string
  needs_confirmation: boolean
  note: string
}

export type ConditionQuestion = { field: string; question: string; options: string[] }

export type ParseResponse = {
  synthetic: true
  assumptions: string[]
  candidates: ConditionCandidate[]
  questions: ConditionQuestion[]
  understood: boolean
}

export const REACT_TIMEOUT_MS = 1500

export async function react(
  requestId: string,
  message: string,
  phase: ReactPhase = 'input',
): Promise<ReactResponse> {
  const data = await post(
    '/react',
    { request_id: requestId, message, context: { phase } },
    REACT_TIMEOUT_MS,
  )
  if (
    !isRecord(data) ||
    typeof data.request_id !== 'string' ||
    typeof data.expression_id !== 'string' ||
    typeof data.confidence !== 'number'
  ) {
    throw contractError()
  }
  return data as ReactResponse
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

export async function parseConditions(
  message: string,
  current?: CompareRequest,
): Promise<ParseResponse> {
  const body: Record<string, unknown> = { message }
  if (current) {
    const { management_overrides: _drop, living: _living, ...rest } = current
    body.current = rest
  }
  const data = await post('/conditions/parse', body)
  if (
    !isRecord(data) ||
    !Array.isArray(data.candidates) ||
    !Array.isArray(data.questions) ||
    typeof data.understood !== 'boolean'
  ) {
    throw contractError()
  }
  const candidates: ConditionCandidate[] = data.candidates
    .filter(isRecord)
    .filter((c) => typeof c.field === 'string' && 'value' in c)
    .map((c) => ({
      field: text(c.field),
      value: c.value,
      display: text(c.display),
      source_text: text(c.source_text),
      needs_confirmation: c.needs_confirmation === true,
      note: text(c.note),
    }))
  const questions: ConditionQuestion[] = data.questions
    .filter(isRecord)
    .filter((q) => typeof q.question === 'string')
    .map((q) => ({
      field: text(q.field),
      question: text(q.question),
      options: Array.isArray(q.options) ? q.options.filter((o) => typeof o === 'string') : [],
    }))
  return {
    synthetic: true,
    assumptions: Array.isArray(data.assumptions) ? data.assumptions.map(String) : [],
    candidates,
    questions,
    understood: data.understood,
  }
}
