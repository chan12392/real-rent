// 대화 상태·설명 로직 검사. 의존성 없이 실행: node frontend/scripts/check-chat.ts (Node 24 타입 제거 실행)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  characterLabel,
  chatReducer,
  changesFor,
  createInitialState,
  decideExpression,
  GREETING,
} from '../src/lib/chat.ts'
import { createSettler, LISTEN_INTERRUPT_MIN_MS, QUICK_CHIPS, REACT_HOLD_MS, settleDelay } from '../src/lib/chat.ts'
import type { ChatAction, ChatState, FaceClock, IntensityTable } from '../src/lib/chat.ts'
import { applyChanges, buildRequest, DEFAULT_FORM } from '../src/lib/conditions.ts'
import { explainCompare, explainError } from '../src/lib/explain.ts'
import { casualize, currentPersona, personaIdFromSearch, RENTI, BOGEUM } from '../src/lib/persona.ts'
import type { Persona } from '../src/lib/persona.ts'

// 캐릭터 컴포넌트의 DEFAULT_INTENSITY 대신 쓰는 시험용 표 (confidence 와 다른 값으로 둔다).
const TABLE: IntensityTable = {
  neutral: 0.3,
  listening: 0.4,
  thinking: 0.5,
  happy: 0.7,
  empathetic: 0.6,
  concerned: 0.55,
  surprised: 0.8,
  apologetic: 0.65,
}

let failed = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    console.log(`PASS  ${name}`)
  } catch (error) {
    failed++
    console.log(`FAIL  ${name}\n      ${(error as Error).message}`)
  }
}
const run = (s: ChatState, ...actions: ChatAction[]) => actions.reduce(chatReducer, s)
const fresh = () => createInitialState(TABLE)

const parsed = (field: string, value: unknown) => ({
  synthetic: true as const,
  assumptions: [],
  candidates: [
    { field, value, display: '', source_text: '월세 60 이하', needs_confirmation: true, note: '만 원 단위' },
  ],
  questions: [],
  understood: true,
})

check('AT02 역순 응답 무시: r-1 응답이 r-2 뒤에 와도 버린다', () => {
  let s = run(
    fresh(),
    { type: 'submit', requestId: 'r-1', text: '월세 60 이하' },
    { type: 'submit', requestId: 'r-2', text: '40분 안쪽' },
  )
  const before = s
  s = run(s, { type: 'reactOk', requestId: 'r-1', expressionId: 'happy', confidence: 0.9 })
  s = run(s, { type: 'parseOk', requestId: 'r-1', response: parsed('monthly_budget_krw', 600000) })
  assert.equal(s, before, '낡은 응답이 상태를 바꿨다')
  assert.equal(s.pending, null)
  assert.equal(s.expression, 'thinking')
  s = run(s, { type: 'reactOk', requestId: 'r-2', expressionId: 'happy', confidence: 0.9 })
  assert.equal(s.expression, 'happy')
})

check('confidence<0.5 → neutral, ≥0.5 → 표정별 기본 강도(confidence 아님)', () => {
  assert.deepEqual(decideExpression('happy', 0.49, TABLE), { expression: 'neutral', intensity: TABLE.neutral })
  assert.deepEqual(decideExpression('happy', 0.95, TABLE), { expression: 'happy', intensity: TABLE.happy })
  assert.deepEqual(decideExpression('happy', 0.5, TABLE), { expression: 'happy', intensity: TABLE.happy })
})

check('enum 밖/잘못된 값 → neutral', () => {
  const bad: [unknown, unknown][] = [
    ['smirk', 0.9],
    [undefined, 0.9],
    [42, 0.9],
    ['happy', 'high'],
    ['happy', NaN],
    ['happy', 1.5],
  ]
  for (const [id, conf] of bad) {
    assert.equal(decideExpression(id, conf, TABLE).expression, 'neutral', `${String(id)}/${String(conf)}`)
  }
  const s = run(
    fresh(),
    { type: 'submit', requestId: 'r-1', text: 'x' },
    { type: 'reactOk', requestId: 'r-1', expressionId: 'smirk', confidence: 0.99 },
  )
  assert.equal(s.expression, 'neutral')
})

check('react 실패 → neutral 복구, 조건 확인은 계속, 재전송 가능', () => {
  let s = run(
    fresh(),
    { type: 'submit', requestId: 'r-1', text: '월세 60 이하' },
    { type: 'reactFail', requestId: 'r-1' },
  )
  s = run(s, { type: 'parseOk', requestId: 'r-1', response: parsed('monthly_budget_krw', 600000) })
  assert.equal(s.expression, 'neutral')
  assert.equal(s.characterState, 'idle')
  assert.equal(s.pending?.candidates.length, 1)
  // 처리 중 같은 문장 중복 전송은 무시, 실패 뒤에는 재전송 가능
  const dup = run(
    fresh(),
    { type: 'submit', requestId: 'r-1', text: 'a' },
    { type: 'submit', requestId: 'r-2', text: 'a' },
  )
  assert.equal(dup.latestRequestId, 'r-1')
  const failedBoth = run(
    fresh(),
    { type: 'submit', requestId: 'r-1', text: 'a' },
    { type: 'reactFail', requestId: 'r-1' },
    { type: 'parseFail', requestId: 'r-1' },
  )
  assert.equal(failedBoth.characterState, 'error')
  assert.equal(failedBoth.messages.at(-1)?.retryText, 'a')
  const retry = run(failedBoth, { type: 'submit', requestId: 'r-2', text: 'a' })
  assert.equal(retry.latestRequestId, 'r-2')
})

check('빈 입력 전송 차단, 입력은 서버 호출 없이 listening', () => {
  const s = fresh()
  assert.equal(chatReducer(s, { type: 'submit', requestId: 'r-1', text: '   ' }), s)
  const t = run(s, { type: 'typing' }, { type: 'typing' })
  assert.equal(t.characterState, 'listening')
  assert.equal(t.typingPulse, 2)
  assert.equal(run(t, { type: 'idleTimeout' }).characterState, 'idle')
})

check('취소 시 조건 불변 / 반영 시 해당 항목만 변경', () => {
  let s = run(
    fresh(),
    { type: 'submit', requestId: 'r-1', text: '월세 60 이하' },
    { type: 'parseOk', requestId: 'r-1', response: parsed('monthly_budget_krw', 600000) },
  )
  const cancelled = run(s, { type: 'resolve', index: 'all', decision: 'cancel' })
  assert.deepEqual(changesFor(cancelled.pending, 'all'), [])
  assert.deepEqual(applyChanges(DEFAULT_FORM, changesFor(cancelled.pending, 'all')), DEFAULT_FORM)
  assert.equal(cancelled.appliedCount, 0)
  const form = applyChanges(DEFAULT_FORM, changesFor(s.pending, 0))
  assert.equal(form.budget, '600000')
  assert.equal(form.deposit, DEFAULT_FORM.deposit)
  s = run(s, { type: 'resolve', index: 0, decision: 'apply' })
  assert.equal(s.appliedCount, 1)
  assert.deepEqual(changesFor(s.pending, 'all'), [], '이미 반영한 항목은 다시 반영 대상이 아니다')
  // 형식이 틀린 값은 폼을 바꾸지 않는다
  const bad = [
    { field: 'priority' as const, value: 'fast' },
    { field: 'office_days' as const, value: -3 },
  ]
  assert.deepEqual(applyChanges(DEFAULT_FORM, bad), DEFAULT_FORM)
})

check('숫자 없는 의도: 질문만 말풍선, 수치 자동 채움 없음', () => {
  const resp = {
    synthetic: true as const,
    assumptions: [],
    candidates: [],
    questions: [{ field: 'monthly_budget_krw', question: '월 지출 한도를 얼마로 할까요?', options: [] }],
    understood: true,
  }
  const s = run(
    fresh(),
    { type: 'submit', requestId: 'r-1', text: '월세를 조금 줄이고 싶어' },
    { type: 'parseOk', requestId: 'r-1', response: resp },
  )
  assert.equal(s.pending, null)
  assert.equal(s.messages.at(-1)?.text, '월 지출 한도를 얼마로 할까요?')
})

check('understood=false: 이해 못함 + 원문 보존 + 폼 안내', () => {
  const resp = { synthetic: true as const, assumptions: [], candidates: [], questions: [], understood: false }
  const s = run(
    fresh(),
    { type: 'submit', requestId: 'r-1', text: '아무말' },
    { type: 'parseOk', requestId: 'r-1', response: resp },
  )
  const last = s.messages.at(-1)!.text
  assert.ok(last.includes('정확히 이해하지 못했어요') && last.includes('아무말') && last.includes('왼쪽'))
})

// ───── 설명 문장 ─────
const leg = { minutes: 20, fare_krw: 1500, transfers: 0, walk_minutes: 5 }
type Status = 'pass' | 'fail' | 'unknown'
const mk = (
  id: string,
  label: string,
  rank: number | null,
  total: number | null,
  trip: number | null,
  status: Status = 'pass',
  reason: string | null = null,
) => ({
  listing_id: id,
  label,
  gu: '',
  dong: '',
  status,
  primary_reason: reason,
  reasons: [],
  rank,
  management_overridden: false,
  cost: {
    deposit_krw: 0,
    monthly_rent_krw: 0,
    monthly_management_krw: null,
    monthly_commute_krw: null,
    monthly_total_krw: total,
    initial_cash_krw: 0,
    stay_total_krw: null,
  },
  commute: { outbound: leg, return: leg, round_trip_minutes: trip },
  scores: { cost: null, time: null, convenience: null, livability: null },
})
const passData = {
  synthetic: true as const,
  conditions: {
    deposit_limit_krw: 1,
    monthly_budget_krw: 1,
    move_in_by: '2026-11-01',
    office_days: 20,
    max_one_way_minutes: 40,
    max_transfers: 1,
    priority: 'cost' as const,
    stay_months: 12,
  },
  assumptions: [],
  counts: { pass: 3, fail: 1, unknown: 0, route_failed: 0 },
  recommended: ['A', 'B', 'C'],
  results: [
    mk('B', '이쪽동 원룸', 2, 701000, 50),
    mk('A', '저쪽동 원룸', 1, 654000, 44),
    mk('C', '그쪽동 원룸', 3, null, 60),
    mk('D', '먼동 원룸', null, null, null, 'fail', '편도 시간 초과'),
  ],
}

check('AT07 설명의 모든 숫자가 응답 값(또는 응답 값끼리의 차이/순위)과 일치', () => {
  const { text, kind } = explainCompare(passData)
  assert.equal(kind, 'pass')
  assert.ok(text.indexOf('저쪽동') < text.indexOf('이쪽동'), '1위가 먼저')
  assert.ok(text.includes('654,000원') && text.includes('44분'))
  assert.ok(text.includes('701,000원') && text.includes('50분'))
  assert.ok(text.includes('47,000원 더 듦') && text.includes('6분 더 걸림'), '차이는 응답 값끼리의 차')
  assert.ok(text.includes('미확인'), '월 지출 null 은 미확인')
  assert.ok(text.endsWith('합성 시연 데이터 기준이에요. 실제 매물·가격이 아니에요.'))
  assert.ok(!/찾았/.test(text))
  const counts = Object.values(passData.counts)
  // 응답 값 + 응답 값끼리의 차이(701000-654000, 50-44, 60-44) + 순위/건수
  const allowed = new Set([654000, 701000, 44, 50, 60, 701000 - 654000, 50 - 44, 60 - 44, 1, 2, 3, 4, ...counts])
  const stripped = text.replace(/(저쪽동|이쪽동|그쪽동|먼동) 원룸/g, '')
  const nums = (stripped.match(/\d[\d,]*/g) ?? []).map((n) => Number(n.replace(/,/g, '')))
  assert.ok(nums.length > 0)
  for (const n of nums) assert.ok(allowed.has(n), `응답에 없는 숫자 ${n}`)
})

const amt = (amount: number | null, low: number | null, high: number | null) => ({
  amount_krw: amount,
  low_krw: low,
  high_krw: high,
  estimated_share_pct: amount == null ? null : 6.03,
})
const withLiving = (r: ReturnType<typeof mk>, cash: ReturnType<typeof amt>) => ({
  ...r,
  living_cost: {
    cash_monthly: cash,
    economic_monthly: amt(null, null, null),
    initial_cash: amt(11004000, 10880000, 11144000),
    items: [],
    peak: {},
    management_estimated: false,
    parameter_status: {},
  },
})

check('참고 월 거주비 문장: 숫자가 응답 값과 일치, null이면 생략, 없어도 기존 문장 유지', () => {
  const withCash = {
    ...passData,
    results: passData.results.map((r) =>
      r.listing_id === 'A' ? withLiving(r, amt(672555, 663017, 682694)) : r,
    ),
  }
  const { text } = explainCompare(withCash)
  const line = text.split('\n').find((l) => l.startsWith('부대경비까지 넣은 참고 월 거주비는'))
  assert.ok(line, '문장이 있다')
  assert.equal(line, '부대경비까지 넣은 참고 월 거주비는 672,555원(범위 663,017~682,694원)이에요.')
  assert.ok(text.indexOf('1위 저쪽동') < text.indexOf(line) && text.indexOf(line) < text.indexOf('2위'), '1위 설명 뒤')
  const nums = (line.match(/\d[\d,]*/g) ?? []).map((n) => Number(n.replace(/,/g, '')))
  assert.deepEqual(nums, [672555, 663017, 682694], '문장 숫자는 응답의 amount/low/high 뿐')
  assert.ok(text.endsWith('합성 시연 데이터 기준이에요. 실제 매물·가격이 아니에요.'))
  // 합계 null → 문장 생략
  const nullCash = {
    ...passData,
    results: passData.results.map((r) => (r.listing_id === 'A' ? withLiving(r, amt(null, null, null)) : r)),
  }
  assert.ok(!explainCompare(nullCash).text.includes('참고 월 거주비'))
  // 하위 호환: living_cost 없는 응답은 기존 문장과 같다
  assert.ok(!explainCompare(passData).text.includes('참고 월 거주비'))
  // 1위가 아닌 매물의 값은 쓰지 않는다
  const only2nd = {
    ...passData,
    results: passData.results.map((r) => (r.listing_id === 'B' ? withLiving(r, amt(111111, 1, 2)) : r)),
  }
  assert.ok(!explainCompare(only2nd).text.includes('111,111'))
})

check('생활 조건 폼: 기본값이면 living 생략, 바꾸면 persons·heating 전달, 범위 밖은 오류', () => {
  const base = buildRequest(DEFAULT_FORM, {})
  assert.ok(!Array.isArray(base) && base.living === undefined)
  const changed = buildRequest({ ...DEFAULT_FORM, persons: '2', heating: 'electric' }, {})
  assert.ok(!Array.isArray(changed))
  assert.deepEqual((changed as { living?: unknown }).living, { persons: 2, heating: 'electric' })
  assert.ok(Array.isArray(buildRequest({ ...DEFAULT_FORM, persons: '7' }, {})))
  assert.ok(Array.isArray(buildRequest({ ...DEFAULT_FORM, persons: '0' }, {})))
  // 대화 반영은 기존 필드만 건드리고 생활 조건을 유지한다
  const f = applyChanges({ ...DEFAULT_FORM, persons: '3' }, [{ field: 'monthly_budget_krw', value: 600000 }])
  assert.equal(f.persons, '3')
  assert.equal(f.budget, '600000')
})

check('AT08 pass 0건 문장 ≠ 서버 오류 문장', () => {
  const none = explainCompare({
    ...passData,
    counts: { pass: 0, fail: 2, unknown: 1, route_failed: 0 },
    results: [
      mk('D', '먼동 원룸', null, null, null, 'fail', '편도 시간 초과'),
      mk('E', '비싼동 원룸', null, null, null, 'fail', '월 예산 초과'),
      mk('F', '모름동 원룸', null, null, null, 'unknown', '편도 시간 초과'),
    ],
  })
  const err = explainError('HTTP 500')
  assert.equal(none.kind, 'none')
  assert.equal(err.kind, 'error')
  assert.ok(none.text.includes('조건에 맞는 매물이 없어요'))
  assert.ok(none.text.includes('편도 시간 초과(2건)') && none.text.includes('월 예산 초과(1건)'))
  assert.ok(err.text.includes('서버 오류') && !err.text.includes('조건에 맞는 매물이 없어요'))
  assert.notEqual(none.text, err.text)
  assert.ok(none.text.includes('합성 시연 데이터 기준'))
})

check('결과 표정/상태: pass→happy, none→empathetic, error→apologetic', () => {
  const base = run(fresh(), { type: 'compareStart', token: 1 })
  assert.equal(base.characterState, 'comparing')
  assert.ok(!base.messages.some((m) => /찾았/.test(m.text)), '결과 전 찾았다 류 금지')
  const cases: ['pass' | 'none' | 'error', string][] = [
    ['pass', 'happy'],
    ['none', 'empathetic'],
    ['error', 'apologetic'],
  ]
  for (const [kind, face] of cases) {
    const s = run(base, { type: 'compareDone', token: 1, kind, text: 'x' })
    assert.equal(s.expression, face)
  }
  const stale = run(
    base,
    { type: 'compareStart', token: 2 },
    { type: 'compareDone', token: 1, kind: 'pass', text: 'x' },
  )
  assert.equal(stale.characterState, 'comparing', '낡은 비교 결과 무시')
})

// ───── 페르소나(렌티/보금이) ─────
const OLD_RENTI = {
  greeting: '안녕하세요, 렌티예요. 원하는 조건을 편하게 말해 주세요. 예: “월세 60 이하로, 40분 안쪽”',
  confirm: '이렇게 이해했어요. 맞는지 확인하고 반영해 주세요. 확인 전에는 조건을 바꾸지 않아요.',
  applied: '월 지출 한도 조건을 왼쪽 폼에 반영했어요. 준비되면 ‘이 조건으로 비교하기’를 눌러 주세요.',
  cancelled: '월 지출 한도 조건은 반영하지 않았어요. 기존 조건은 그대로예요.',
  notUnderstood:
    '정확히 이해하지 못했어요. 입력하신 내용은 그대로 두었어요: “아무말”\n왼쪽 ‘내 조건’에서 직접 수정해 주세요.',
  parseFail: '조건을 해석하는 서버에 연결하지 못했어요. 왼쪽 ‘내 조건’에서 직접 입력하거나 다시 보내 주세요.',
  invalid: '비교할 수 없어요. 월세를 입력해 주세요. 거리를 확인해 주세요.',
  statuses: [
    '렌티가 기다리고 있어요',
    '렌티가 입력을 듣고 있어요',
    '렌티가 생각하고 있어요',
    '렌티가 반응하고 있어요',
    '렌티가 비교 결과를 기다리고 있어요',
    '렌티가 결과를 전하고 있어요',
    '렌티가 오류를 알리고 있어요',
  ],
}
const mkChat = (persona: Persona) => createInitialState(TABLE, persona)
const pass1 = (persona: Persona) =>
  run(
    mkChat(persona),
    { type: 'submit', requestId: 'r-1', text: '월세 60 이하' },
    { type: 'parseOk', requestId: 'r-1', response: parsed('monthly_budget_krw', 600000) },
  )
const noneData = {
  ...passData,
  counts: { pass: 0, fail: 1, unknown: 0, route_failed: 0 },
  results: [mk('D', '먼동 원룸', null, null, null, 'fail', '편도 시간 초과')],
}
const compared = (persona: Persona, e: { kind: 'pass' | 'none' | 'error'; text: string }) =>
  run(run(mkChat(persona), { type: 'compareStart', token: 1 }), {
    type: 'compareDone',
    token: 1,
    kind: e.kind,
    text: e.text,
  })
const questionResp = (options: string[]) => ({
  synthetic: true as const,
  assumptions: [],
  candidates: [],
  questions: [{ field: 'monthly_budget_krw', question: '월 지출 한도를 얼마로 할까요?', options }],
  understood: true,
})
const notUnderstoodResp = { synthetic: true as const, assumptions: [], candidates: [], questions: [], understood: false }

check('(a) renti persona: 모든 문구가 기존과 동일', () => {
  assert.equal(currentPersona().id, 'bogeum', 'window 없는 환경(쿼리 없음)의 기본은 보금이')
  assert.equal(createInitialState(TABLE).persona, RENTI)
  assert.equal(createInitialState(TABLE).messages[0].text, OLD_RENTI.greeting)
  assert.equal(RENTI.greeting, GREETING)
  assert.equal(RENTI.panelTitle, '렌티와 대화로 조건 정하기')
  assert.equal(RENTI.logLabel, '렌티와 나눈 대화')
  assert.equal(RENTI.inputLabel, '렌티에게 조건 말하기')
  assert.equal(RENTI.name, '렌티')
  let s = pass1(RENTI)
  assert.equal(s.messages.at(-1)?.text, OLD_RENTI.confirm)
  s = run(s, { type: 'resolve', index: 0, decision: 'apply' })
  assert.equal(s.messages.at(-1)?.text, OLD_RENTI.applied)
  const c = run(pass1(RENTI), { type: 'resolve', index: 0, decision: 'cancel' })
  assert.equal(c.messages.at(-1)?.text, OLD_RENTI.cancelled)
  const none = run(
    fresh(),
    { type: 'submit', requestId: 'r-1', text: '아무말' },
    { type: 'parseOk', requestId: 'r-1', response: notUnderstoodResp },
  )
  assert.equal(none.messages.at(-1)?.text, OLD_RENTI.notUnderstood)
  const pf = run(fresh(), { type: 'submit', requestId: 'r-1', text: 'a' }, { type: 'parseFail', requestId: 'r-1' })
  assert.equal(pf.messages.at(-1)?.text, OLD_RENTI.parseFail)
  const inv = run(fresh(), { type: 'compareInvalid', errors: ['월세를 입력해 주세요.', '거리를 확인해 주세요.'] })
  assert.equal(inv.messages.at(-1)?.text, OLD_RENTI.invalid)
  for (const e of [explainCompare(passData), explainCompare(noneData), explainError('HTTP 500')]) {
    assert.equal(compared(RENTI, e).messages.at(-1)?.text, e.text, '결과 문장은 렌티에서 한 글자도 바뀌지 않는다')
  }
  const q = run(
    fresh(),
    { type: 'submit', requestId: 'r-1', text: 'x' },
    { type: 'parseOk', requestId: 'r-1', response: questionResp(['50만', '60만']) },
  )
  assert.equal(q.messages.at(-1)?.text, '월 지출 한도를 얼마로 할까요? (50만 / 60만)')
  const states = ['idle', 'listening', 'thinking', 'reacting', 'comparing', 'result', 'error'] as const
  states.forEach((st, i) => assert.equal(characterLabel(st, 'neutral'), OLD_RENTI.statuses[i]))
  assert.equal(characterLabel('result', 'happy'), '렌티가 결과를 전하고 있어요 (밝은 표정)')
  const cues = ['confirm', 'applied', 'question', 'not_understood', 'comparing', 'result_pass', 'result_none', 'server_error', 'cancel'] as const
  for (const v of cues) assert.equal(RENTI.voice('본문 654,000원', v), '본문 654,000원')
})

check('(b) bogeum: “감탄사 (본문)” 형식, explain 숫자·매물명은 그대로', () => {
  const exp = explainCompare(passData, 'casual')
  const said = compared(BOGEUM, exp).messages.at(-1)!.text
  assert.equal(said, `짠! (${exp.text})`, '이미 반말인 설명은 voice 가 다시 바꾸지 않는다')
  const nums = (t: string) => t.match(/\d[\d,]*/g) ?? []
  assert.deepEqual(nums(said), nums(exp.text), '숫자 목록이 explain 결과와 같다')
  assert.ok(said.includes('저쪽동 원룸') && said.includes('654,000원') && said.includes('47,000원 더 듦'))
  const none = explainCompare(noneData, 'casual')
  assert.equal(compared(BOGEUM, none).messages.at(-1)?.text, `으앗.. (${none.text})`)
  const err = explainError('HTTP 500', 'casual')
  assert.equal(
    compared(BOGEUM, err).messages.at(-1)?.text,
    '으아앙.. (서버 오류로 비교 결과를 받지 못했어 (HTTP 500). 조건에 맞는 매물이 없다는 뜻은 아니야. 잠시 뒤 다시 비교해 줘.)',
  )
  // 보완 질문: 서버 질문 본문 그대로 + 감탄사
  const q = run(
    mkChat(BOGEUM),
    { type: 'submit', requestId: 'r-1', text: '월세를 조금 줄이고 싶어' },
    { type: 'parseOk', requestId: 'r-1', response: questionResp([]) },
  )
  assert.equal(q.messages.at(-1)?.text, '갸웃? (월 지출 한도를 얼마로 할까?)', '서버 질문도 반말로(계약은 그대로)')
  // 확인 카드 안내·반영·취소·이해 못함
  const c = pass1(BOGEUM)
  assert.ok(c.messages.at(-1)!.text.startsWith('콩! ('))
  assert.ok(run(c, { type: 'resolve', index: 0, decision: 'apply' }).messages.at(-1)!.text.startsWith('콩콩! ('))
  assert.ok(run(c, { type: 'resolve', index: 0, decision: 'cancel' }).messages.at(-1)!.text.startsWith('흐흥~ ('))
  const nu = run(
    mkChat(BOGEUM),
    { type: 'submit', requestId: 'r-1', text: '아무말' },
    { type: 'parseOk', requestId: 'r-1', response: notUnderstoodResp },
  )
  const nuText = nu.messages.at(-1)!.text
  assert.ok(nuText.startsWith('엥엥? (') && nuText.includes('“아무말”'))
  const pf = run(mkChat(BOGEUM), { type: 'submit', requestId: 'r-1', text: 'a' }, { type: 'parseFail', requestId: 'r-1' })
  assert.ok(pf.messages.at(-1)!.text.startsWith('으아앙.. (') && pf.messages.at(-1)!.retryText === 'a')
  assert.equal(mkChat(BOGEUM).messages[0].text, BOGEUM.greeting)
  assert.ok(BOGEUM.greeting.includes('보금이') && !BOGEUM.greeting.includes('렌티'))
  assert.equal(BOGEUM.panelTitle, '보금이와 대화로 조건 정하기')
})

check('(c) bogeum: 합성 시연 데이터 고지 유지', () => {
  for (const data of [passData, noneData]) {
    const text = compared(BOGEUM, explainCompare(data, 'casual')).messages.at(-1)!.text
    assert.ok(text.includes('합성 시연 데이터 기준'))
    assert.ok(text.endsWith('실제 매물·가격 아니야.)'))
  }
})

check('(d) bogeum 이름표 “보금이”, 문구에 렌티 없음', () => {
  assert.equal(BOGEUM.name, '보금이')
  assert.equal(RENTI.name, '렌티')
  assert.equal(mkChat(BOGEUM).persona.name, '보금이')
  const all = [
    BOGEUM.greeting,
    BOGEUM.panelTitle,
    BOGEUM.logLabel,
    BOGEUM.inputLabel,
    ...Object.values(BOGEUM.statusLabels),
    BOGEUM.lines.confirm,
    BOGEUM.lines.applied('x'),
    BOGEUM.lines.cancelled('x'),
    BOGEUM.lines.notUnderstood('x'),
    BOGEUM.lines.parseFail,
    BOGEUM.lines.invalid(['x']),
    characterLabel('thinking', 'neutral', BOGEUM),
  ]
  for (const t of all) assert.ok(!t.includes('렌티'), t)
  assert.equal(characterLabel('listening', 'neutral', BOGEUM), '보금이가 쫑긋 듣는 중')
  assert.equal(characterLabel('thinking', 'neutral', BOGEUM), '갸웃? 생각하는 중')
})

// ───── D3: 표정 유지·기본 스킨·칩·말투 ─────

/** 가짜 시계·타이머. advance(ms) 만큼 시간을 보내며 만기된 타이머를 차례로 실행한다. */
function fakeClock() {
  let t = 0
  let nextId = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  const clock: FaceClock = {
    now: () => t,
    setTimeout: (fn, ms) => {
      const id = nextId++
      timers.set(id, { at: t + ms, fn })
      return id
    },
    clearTimeout: (h) => void timers.delete(h as number),
  }
  const advance = (ms: number) => {
    const end = t + ms
    for (;;) {
      const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      t = due[1].at
      due[1].fn()
    }
    t = end
  }
  return { clock, advance, pending: () => timers.size }
}

/** 상태 저장소 + 정착기를 가짜 시계로 묶은 작은 하네스. */
function harness() {
  const fc = fakeClock()
  let state = fresh()
  const dispatch = (a: ChatAction) => {
    state = chatReducer(state, a)
    settler.sync(state)
  }
  const settler = createSettler(fc.clock, dispatch)
  return { fc, dispatch, get: () => state }
}
const reactOkAt = (h: ReturnType<typeof harness>, id: string, expr = 'empathetic') => {
  h.dispatch({ type: 'submit', requestId: id, text: '월세를 조금 줄이고 싶어' })
  h.dispatch({ type: 'parseOk', requestId: id, response: notUnderstoodResp })
  h.dispatch({ type: 'reactOk', requestId: id, expressionId: expr, confidence: 0.9, at: h.fc.clock.now() })
}

check('반응 표정은 3초 유지 후 idle (가짜 시계)', () => {
  const h = harness()
  reactOkAt(h, 'r-1')
  assert.equal(h.get().characterState, 'reacting')
  assert.equal(h.get().expression, 'empathetic')
  h.fc.advance(REACT_HOLD_MS - 1)
  assert.equal(h.get().characterState, 'reacting', '2.999초: 아직 유지')
  h.fc.advance(1)
  assert.equal(h.get().characterState, 'idle', '3초: 대기로 복귀')
  assert.equal(h.get().expression, 'neutral')
})

check('응답이 늦게 끝나도 반응 표정이 처음 보인 시각부터 3초를 센다', () => {
  const h = harness()
  h.dispatch({ type: 'submit', requestId: 'r-1', text: '월세를 조금 줄이고 싶어' })
  h.dispatch({ type: 'reactOk', requestId: 'r-1', expressionId: 'empathetic', confidence: 0.9, at: 0 })
  h.fc.advance(2000) // parse 아직 진행 중: 복귀 금지
  assert.equal(h.get().characterState, 'reacting')
  h.dispatch({ type: 'parseOk', requestId: 'r-1', response: notUnderstoodResp })
  assert.equal(h.get().characterState, 'reacting', 'parse 가 끝난 직후에도 3초 전이면 유지')
  h.fc.advance(999)
  assert.equal(h.get().characterState, 'reacting')
  h.fc.advance(1)
  assert.equal(h.get().characterState, 'idle')
})

check('반응 표정이 1초 미만이면 타이핑이 끊지 못하고, 1초 이상이면 listening', () => {
  const h = harness()
  reactOkAt(h, 'r-1')
  h.fc.advance(LISTEN_INTERRUPT_MIN_MS - 1)
  h.dispatch({ type: 'typing', at: h.fc.clock.now() })
  assert.equal(h.get().characterState, 'reacting', '0.999초: 유지')
  assert.equal(h.get().expression, 'empathetic')
  h.fc.advance(1)
  h.dispatch({ type: 'typing', at: h.fc.clock.now() })
  assert.equal(h.get().characterState, 'listening', '1초: listening 전환')
  assert.equal(h.get().expression, 'listening')
  assert.equal(h.fc.pending(), 0, 'listening 으로 바뀌면 복귀 타이머가 남지 않는다')
})

check('결과(result) 표정은 시간이 지나도 유지, 다음 입력(타이핑)에 listening', () => {
  const h = harness()
  h.dispatch({ type: 'compareStart', token: 1 })
  h.dispatch({ type: 'compareDone', token: 1, kind: 'none', text: 'x' })
  assert.equal(h.get().characterState, 'result')
  assert.equal(h.get().expression, 'empathetic')
  h.fc.advance(60_000)
  assert.equal(h.get().characterState, 'result', '1분 뒤에도 유지')
  assert.equal(h.get().expression, 'empathetic')
  h.dispatch({ type: 'typing', at: h.fc.clock.now() })
  assert.equal(h.get().characterState, 'listening')
})

check('settleDelay: 응답/비교 대기 중에는 null, 시간 계산', () => {
  const inflight = run(fresh(), { type: 'submit', requestId: 'r-1', text: 'a' })
  assert.equal(settleDelay(inflight, 0, 0), null)
  const s = run(
    fresh(),
    { type: 'submit', requestId: 'r-1', text: 'a' },
    { type: 'parseOk', requestId: 'r-1', response: notUnderstoodResp },
    { type: 'reactOk', requestId: 'r-1', expressionId: 'happy', confidence: 1, at: 100 },
  )
  assert.equal(settleDelay(s, 100, 100), REACT_HOLD_MS)
  assert.equal(settleDelay(s, 100, 100 + REACT_HOLD_MS + 5), 0)
})

check('오래된 응답(AT02)은 표정 유지 시각도 바꾸지 않는다', () => {
  const h = harness()
  h.dispatch({ type: 'submit', requestId: 'r-1', text: 'a' })
  h.dispatch({ type: 'submit', requestId: 'r-2', text: 'b' })
  h.dispatch({ type: 'reactOk', requestId: 'r-1', expressionId: 'happy', confidence: 1, at: 0 })
  assert.equal(h.get().characterState, 'thinking', '낡은 응답은 표정을 바꾸지 않는다')
  assert.equal(h.get().faceSince, null)
})

check('기본 스킨: 쿼리 없음=bogeum, ?skin=renti=renti', () => {
  assert.equal(personaIdFromSearch(''), 'bogeum')
  assert.equal(personaIdFromSearch('?skin=renti'), 'renti')
  assert.equal(personaIdFromSearch('?foo=1&skin=renti'), 'renti')
  assert.equal(personaIdFromSearch('?skin=other'), 'bogeum', '알 수 없는 값은 기본 보금이')
})

check('칩 4개, 누르면 일반 전송(submit)과 같은 액션·같은 경로', () => {
  assert.deepEqual([...QUICK_CHIPS], ['월세 60 이하로', '40분 안쪽', '환승 없이', '11월 1일 입주'])
  for (const chip of QUICK_CHIPS) {
    const typed = chatReducer(fresh(), { type: 'submit', requestId: 'r-1', text: chip })
    assert.equal(typed.messages.at(-1)?.text, chip)
    assert.equal(typed.inflightText, chip)
  }
  // 같은 칩을 처리 중에 다시 눌러도 중복 전송되지 않는다(같은 inflight 규칙).
  const once = chatReducer(fresh(), { type: 'submit', requestId: 'r-1', text: QUICK_CHIPS[0] })
  assert.equal(chatReducer(once, { type: 'submit', requestId: 'r-2', text: QUICK_CHIPS[0] }), once)
  // 컴포넌트: 칩 onClick 은 send(chip) — 입력창 Enter·보내기 버튼과 같은 send(requestId·중복 방지) 하나만 쓴다.
  const src = readFileSync(new URL('../src/components/ChatPanel.tsx', import.meta.url), 'utf8')
  assert.ok(src.includes('className="chat-chips"') && src.includes('className="chat-chip"'))
  assert.ok(src.includes('send(chip)'), '칩은 send 로 전송')
  assert.ok(src.includes('send(draft)'), '일반 전송도 같은 send 를 쓴다')
})

// ───── 보금이 반말 통일 (T1) ─────
// 변경 전(존댓말만 있던 시점) explain 출력을 그대로 박아 둔 값. 렌티는 이 값과 한 글자도 달라지면 안 된다.
const GOLDEN_POLITE = {
  pass: "비교가 끝났어요. 전체 4건 중 통과 3건 · 탈락 1건 · 판단 불가 0건 · 경로 실패 0건이에요.\n1위 저쪽동 원룸: 월 지출 654,000원, 왕복 44분\n2위 이쪽동 원룸: 월 지출 701,000원(1위보다 47,000원 더 듦), 왕복 50분(1위보다 6분 더 걸림)\n3위 그쪽동 원룸: 월 지출 미확인(미확인), 왕복 60분(1위보다 16분 더 걸림)\n합성 시연 데이터 기준이에요. 실제 매물·가격이 아니에요.",
  cash: "비교가 끝났어요. 전체 4건 중 통과 3건 · 탈락 1건 · 판단 불가 0건 · 경로 실패 0건이에요.\n1위 저쪽동 원룸: 월 지출 654,000원, 왕복 44분\n부대경비까지 넣은 참고 월 거주비는 672,555원(범위 663,017~682,694원)이에요.\n2위 이쪽동 원룸: 월 지출 701,000원(1위보다 47,000원 더 듦), 왕복 50분(1위보다 6분 더 걸림)\n3위 그쪽동 원룸: 월 지출 미확인(미확인), 왕복 60분(1위보다 16분 더 걸림)\n합성 시연 데이터 기준이에요. 실제 매물·가격이 아니에요.",
  none: "조건에 맞는 매물이 없어요. 전체 1건 중 통과 0건 · 탈락 1건 · 판단 불가 0건 · 경로 실패 0건이에요.\n주요 탈락 사유: 편도 시간 초과(1건)\n왼쪽 조건을 조정해 다시 비교해 볼 수 있어요.\n합성 시연 데이터 기준이에요. 실제 매물·가격이 아니에요.",
  err: "서버 오류로 비교 결과를 받지 못했어요 (HTTP 500). 조건에 맞는 매물이 없다는 뜻은 아니에요. 잠시 뒤 다시 비교해 주세요.",
  err0: "서버 오류로 비교 결과를 받지 못했어요. 조건에 맞는 매물이 없다는 뜻은 아니에요. 잠시 뒤 다시 비교해 주세요.",
}
const withCashData = {
  ...passData,
  results: passData.results.map((r) => (r.listing_id === 'A' ? withLiving(r, amt(672555, 663017, 682694)) : r)),
}
const numTokens = (t: string) => t.match(/\d[\d,.]*/g) ?? []
const quoted = (t: string) => t.match(/“[^”]*”|‘[^’]*’|"[^"]*"/g) ?? []
// 보금이 말풍선에 남으면 안 되는 존댓말 어미. 말풍선은 “감탄사 (본문)” 이라 닫는 괄호 앞도 본다.
const POLITE_END = /요[.?!]|요\)?$|요\)?\n|니다/
const explainCases = (tone: 'polite' | 'casual') => ({
  pass: explainCompare(passData, tone),
  cash: explainCompare(withCashData, tone),
  none: explainCompare(noneData, tone),
  err: explainError('HTTP 500', tone),
  err0: explainError(undefined, tone),
})
const CUES = [
  'confirm',
  'applied',
  'question',
  'not_understood',
  'comparing',
  'result_pass',
  'result_none',
  'server_error',
  'cancel',
] as const

check('T1-a 렌티 explain/voice 출력은 변경 전과 바이트 동일', () => {
  const defaults = {
    pass: explainCompare(passData),
    cash: explainCompare(withCashData),
    none: explainCompare(noneData),
    err: explainError('HTTP 500'),
    err0: explainError(),
  }
  for (const [label, got] of [['기본', defaults], ['polite', explainCases('polite')]] as const) {
    for (const k of Object.keys(GOLDEN_POLITE) as Array<keyof typeof GOLDEN_POLITE>) {
      assert.equal(got[k].text, GOLDEN_POLITE[k], `${label} ${k}`)
    }
  }
  assert.equal(RENTI.tone, 'polite')
  for (const text of Object.values(GOLDEN_POLITE)) for (const v of CUES) assert.equal(RENTI.voice(text, v), text)
  const q = '월 지출 한도를 얼마로 할까요? 알려 주세요. 다시 확인해 주세요. 읽었습니다.'
  for (const v of CUES) assert.equal(RENTI.voice(q, v), q, '렌티는 서버 문구도 그대로')
  for (const [k, kind] of [['pass', 'pass'], ['none', 'none'], ['err', 'error']] as const) {
    assert.equal(compared(RENTI, { kind, text: GOLDEN_POLITE[k] }).messages.at(-1)?.text, GOLDEN_POLITE[k])
  }
})

check('T1-b 보금이 출력 어디에도 “요.”“요?”“요!”“니다” 어미가 없다', () => {
  const texts: Array<[string, string]> = []
  const flow = (label: string, state: ChatState) => texts.push([label, state.messages.at(-1)!.text])
  for (const [k, e] of Object.entries(explainCases(BOGEUM.tone))) flow(`결과 ${k}`, compared(BOGEUM, e))
  // 존댓말 설명이 들어와도 voice 가 반말로 맞춘다(안전망).
  for (const [k, e] of Object.entries(explainCases('polite'))) flow(`안전망 ${k}`, compared(BOGEUM, e))
  flow('확인 카드', pass1(BOGEUM))
  flow('반영', run(pass1(BOGEUM), { type: 'resolve', index: 0, decision: 'apply' }))
  flow('취소', run(pass1(BOGEUM), { type: 'resolve', index: 0, decision: 'cancel' }))
  flow(
    '이해 못함',
    run(
      mkChat(BOGEUM),
      { type: 'submit', requestId: 'r-1', text: '아무말' },
      { type: 'parseOk', requestId: 'r-1', response: notUnderstoodResp },
    ),
  )
  flow(
    '연결 실패',
    run(mkChat(BOGEUM), { type: 'submit', requestId: 'r-1', text: 'a' }, { type: 'parseFail', requestId: 'r-1' }),
  )
  flow('입력 오류', run(mkChat(BOGEUM), { type: 'compareInvalid', errors: ['월세를 입력해 주세요.', '거리를 확인해 주세요.'] }))
  for (const q of [
    '월 지출 한도를 얼마로 할까요?',
    '환승은 최대 몇 회까지 괜찮을까요?',
    '입주 희망일을 연도와 함께 알려 주세요.',
  ]) {
    const response = { ...questionResp([]), questions: [{ field: 'priority', question: q, options: ['cost', 'time'] }] }
    flow(
      `질문 ${q}`,
      run(
        mkChat(BOGEUM),
        { type: 'submit', requestId: 'r-1', text: 'x' },
        { type: 'parseOk', requestId: 'r-1', response },
      ),
    )
  }
  texts.push(['greeting', BOGEUM.greeting], ['confirm', BOGEUM.lines.confirm], ['parseFail', BOGEUM.lines.parseFail])
  texts.push(...Object.entries(BOGEUM.statusLabels))
  assert.ok(texts.length >= 20)
  assert.equal(BOGEUM.tone, 'casual')
  for (const [label, t] of texts) assert.ok(!POLITE_END.test(t), `${label}: ${JSON.stringify(t)}`)
})

check('T1-c 보금이·렌티 숫자 토큰 목록이 같고, 변환이 따옴표 안 원문을 바꾸지 않는다', () => {
  const polite = explainCases('polite')
  const casual = explainCases('casual')
  for (const k of Object.keys(polite) as Array<keyof typeof polite>) {
    assert.deepEqual(numTokens(casual[k].text), numTokens(polite[k].text), `${k} explain 숫자`)
    assert.equal(casual[k].kind, polite[k].kind)
    const said = compared(BOGEUM, casual[k]).messages.at(-1)!.text
    assert.deepEqual(numTokens(said), numTokens(polite[k].text), `${k} 말풍선 숫자`)
    assert.equal(casualize(casual[k].text), casual[k].text, `${k}: 반말 템플릿은 casualize 를 거쳐도 그대로`)
  }
  const living = casual.cash.text.split('\n').find((l) => l.startsWith('부대경비까지'))
  assert.equal(living, '부대경비까지 넣은 참고 월 거주비는 672,555원(범위 663,017~682,694원)이야.')
  assert.ok(casual.pass.text.startsWith('비교 끝났어! 전체 4건 중 '))
  assert.ok(casual.pass.text.endsWith('합성 시연 데이터 기준이야. 실제 매물·가격 아니야.'))
  const orig = '입력값 5은 허용 범위(0~31)를 벗어납니다. “할까요? 주세요.” 라고 읽었습니다.'
  const out = casualize(orig)
  assert.equal(out, '입력값 5은 허용 범위(0~31)를 벗어나. “할까요? 주세요.” 라고 읽었어.')
  assert.deepEqual(numTokens(out), numTokens(orig))
  assert.deepEqual(quoted(out), quoted(orig))
})

check('T1-d dialogue.py 질문·note 문자열 전체 casualize 표', () => {
  const src = readFileSync(new URL('../../backend/app/engine/dialogue.py', import.meta.url), 'utf8').replace(
    /"""[\s\S]*?"""/g,
    '',
  )
  const found: string[] = []
  for (const m of src.matchAll(/(?<![A-Za-z0-9_])([A-Za-z]{0,2})"((?:[^"\\\n]|\\.)*)"/g)) {
    const prefix = m[1].toLowerCase()
    if (prefix.includes('r') || !/[가-힣]/.test(m[2])) continue
    found.push(prefix.includes('f') ? m[2].replace(/\{[^}]*\}/g, '7') : m[2])
  }
  const uniq = [...new Set(found)]
  assert.ok(uniq.length >= 20, `dialogue.py 문자열 ${uniq.length}개만 찾음`)
  const expected: Record<string, string> = {
    '보증금 한도를 얼마로 할까요?': '보증금 한도를 얼마로 할까?',
    '월 지출 한도(월세+관리비+통근비)를 얼마로 할까요?': '월 지출 한도(월세+관리비+통근비)를 얼마로 할까?',
    '입주 희망일을 연도와 함께 알려 주세요.': '입주 희망일을 연도와 함께 알려 줘.',
    '한 달 출근일을 0~31일 중 며칠로 할까요?': '한 달 출근일을 0~31일 중 며칠로 할까?',
    '편도 통근 시간을 몇 분 이내로 할까요?': '편도 통근 시간을 몇 분 이내로 할까?',
    '환승은 최대 몇 회까지 괜찮을까요?': '환승은 최대 몇 회까지 괜찮을까?',
    '비용과 시간 중 무엇을 우선할까요?': '비용과 시간 중 무엇을 우선할까?',
    '거주 기간을 1~60개월 중 몇 개월로 할까요?': '거주 기간을 1~60개월 중 몇 개월로 할까?',
    '서로 다른 값이 함께 있어 하나를 정할 수 없습니다.': '서로 다른 값이 함께 있어 하나를 정할 수 없어.',
    '정수 단위로 입력해 주세요.': '정수 단위로 입력해 줘.',
    '입력값 7은 허용 범위(7)를 벗어납니다.': '입력값 7은 허용 범위(7)를 벗어나.',
    '금액 전체의 단위와 표기를 확인해 주세요.': '금액 전체의 단위와 표기를 확인해 줘.',
    '주 출근일은 0~7일 정수여야 합니다.': '주 출근일은 0~7일 정수여야 해.',
    '존재하지 않거나 해석할 수 없는 날짜입니다.': '존재하지 않거나 해석할 수 없는 날짜야.',
    '단위 없는 금액을 만 원 단위로 읽었습니다.': '단위 없는 금액을 만 원 단위로 읽었어.',
    '월 지출 한도는 월세+관리비+통근비 합계입니다.': '월 지출 한도는 월세+관리비+통근비 합계야.',
    '월세만의 금액과 합계 한도는 다르므로 확인해 주세요.': '월세만의 금액과 합계 한도는 다르므로 확인해 줘.',
    '금액을 월 지출 한도 후보로 읽었습니다. 월세+관리비+통근비 합계인지 확인해 주세요.':
      '금액을 월 지출 한도 후보로 읽었어. 월세+관리비+통근비 합계인지 확인해 줘.',
    '재택·출근하지 않음을 월 출근일 0일로 읽었습니다. ': '재택·출근하지 않음을 월 출근일 0일로 읽었어. ',
    '부분 재택이면 일수를 확인해 주세요.': '부분 재택이면 일수를 확인해 줘.',
    '7로 읽었습니다.': '7로 읽었어.',
    'round(7*52/12)=7일로 월 출근일을 환산했습니다.': 'round(7*52/12)=7일로 월 출근일을 환산했어.',
  }
  console.log('      dialogue.py 문자열 → casualize 결과')
  for (const s of uniq) {
    const out = casualize(s)
    const via = BOGEUM.voice(s, 'question')
    console.log(`      ${s}\n        → ${out}`)
    assert.ok(!POLITE_END.test(out), `존댓말 어미 남음: ${out}`)
    assert.ok(!POLITE_END.test(via), `voice 에 존댓말 어미 남음: ${via}`)
    assert.deepEqual(numTokens(out), numTokens(s), `숫자 토큰 변경: ${s}`)
    assert.deepEqual(quoted(out), quoted(s), `따옴표 안 원문 변경: ${s}`)
  }
  for (const [from, to] of Object.entries(expected)) {
    assert.ok(uniq.includes(from), `dialogue.py 에서 못 찾음(문구가 바뀌었다면 표를 고친다): ${from}`)
    assert.equal(casualize(from), to)
  }
  // 날짜·환산 f-string 은 실제 값이 들어간 문장으로도 확인한다.
  const real = 'round(5*52/12)=22일로 월 출근일을 환산했습니다.'
  assert.equal(casualize(real), 'round(5*52/12)=22일로 월 출근일을 환산했어.')
  assert.deepEqual(numTokens(casualize(real)), numTokens(real))
  const dated = '연도가 없어 기준일 2026-10-22 이후 가장 가까운 2026-11-01로 읽었습니다.'
  assert.equal(casualize(dated), '연도가 없어 기준일 2026-10-22 이후 가장 가까운 2026-11-01로 읽었어.')
})

// ───── R1 리뷰 재현: 늦은 react 응답과 비교 결과 표정의 순서 ─────

const twoCandidates = {
  synthetic: true as const,
  assumptions: [],
  candidates: [
    { field: 'monthly_budget_krw', value: 900000, display: '', source_text: '월세 90 이하', needs_confirmation: true, note: '' },
    { field: 'max_one_way_minutes', value: 60, display: '', source_text: '60분 안쪽', needs_confirmation: false, note: '' },
  ],
  questions: [],
  understood: true,
}
/** 리뷰 순서: 전송 → parse 정상 → 모두 반영 → 대화 비교 시작·성공(react 는 아직 보류). */
const comparedBeforeReact = (h: ReturnType<typeof harness>) => {
  h.dispatch({ type: 'submit', requestId: 'r-1', text: '월세 90 이하로, 60분 안쪽' })
  h.dispatch({ type: 'parseOk', requestId: 'r-1', response: twoCandidates })
  h.dispatch({ type: 'resolve', index: 'all', decision: 'apply' })
  h.dispatch({ type: 'compareStart', token: 1 })
  h.dispatch({ type: 'compareDone', token: 1, kind: 'pass', text: 'x' })
  assert.equal(h.get().characterState, 'result')
  assert.equal(h.get().expression, 'happy')
}

check('R1-03 비교가 끝난 뒤 도착한 이전 입력의 reactOk 는 결과 표정을 바꾸지 않는다', () => {
  const h = harness()
  comparedBeforeReact(h)
  const seq = h.get().faceSeq
  h.dispatch({ type: 'reactOk', requestId: 'r-1', expressionId: 'listening', confidence: 0.9, at: h.fc.clock.now() })
  assert.equal(h.get().characterState, 'result', '늦은 react 가 result 를 덮었다')
  assert.equal(h.get().expression, 'happy')
  assert.equal(h.get().faceSeq, seq, '표정 순번도 그대로')
  assert.equal(h.get().reactDone, true, '요청 정리 상태는 갱신')
  assert.equal(h.get().inflightText, null, '입력 처리 완료')
  h.fc.advance(60_000)
  assert.equal(h.get().characterState, 'result', '시간이 지나도 결과 표정 유지')
  // 다음 입력의 반응은 다시 표정을 바꾼다
  h.dispatch({ type: 'submit', requestId: 'r-2', text: '월세를 조금 줄이고 싶어' })
  h.dispatch({ type: 'reactOk', requestId: 'r-2', expressionId: 'empathetic', confidence: 0.9, at: h.fc.clock.now() })
  assert.equal(h.get().characterState, 'reacting')
  assert.equal(h.get().expression, 'empathetic')
})

check('R1-03 비교가 끝난 뒤 도착한 이전 입력의 reactFail(1.5초 초과)도 결과 표정을 바꾸지 않는다', () => {
  const h = harness()
  comparedBeforeReact(h)
  h.dispatch({ type: 'reactFail', requestId: 'r-1' })
  assert.equal(h.get().characterState, 'result')
  assert.equal(h.get().expression, 'happy')
  assert.equal(h.get().reactDone, true)
  assert.equal(h.get().inflightText, null)
})

check('R1-03 입력 뒤 시작한 비교가 진행 중이면 react·parse 실패가 비교 표정을 바꾸지 않는다', () => {
  const h = harness()
  h.dispatch({ type: 'submit', requestId: 'r-1', text: 'a' })
  h.dispatch({ type: 'compareStart', token: 1 })
  h.dispatch({ type: 'reactFail', requestId: 'r-1' })
  h.dispatch({ type: 'parseFail', requestId: 'r-1' })
  assert.equal(h.get().characterState, 'comparing')
  assert.equal(h.get().expression, 'thinking')
  assert.equal(h.get().messages.at(-1)?.retryText, 'a', '해석 실패 안내는 그대로 남는다')
  h.dispatch({ type: 'compareDone', token: 1, kind: 'none', text: 'x' })
  assert.equal(h.get().characterState, 'result')
  assert.equal(h.get().expression, 'empathetic')
})

check('R1-04 react 오류·타임아웃은 parse 완료를 기다리지 않고 즉시 neutral 로 복구', () => {
  const h = harness()
  h.dispatch({ type: 'submit', requestId: 'r-1', text: '월세 60 이하로' })
  assert.equal(h.get().characterState, 'thinking')
  h.dispatch({ type: 'reactFail', requestId: 'r-1' }) // 1.5초 타임아웃 또는 HTTP 500
  assert.equal(h.get().parseDone, false, 'parse 는 아직 진행 중')
  assert.equal(h.get().expression, 'neutral', 'parse 완료 전에 neutral')
  assert.equal(h.get().characterState, 'idle')
  assert.notEqual(h.get().inflightText, null, '입력 처리는 아직 끝나지 않았다')
  h.fc.advance(250)
  assert.equal(h.get().expression, 'neutral')
  h.dispatch({ type: 'parseOk', requestId: 'r-1', response: parsed('monthly_budget_krw', 600000) })
  assert.equal(h.get().characterState, 'idle')
  assert.equal(h.get().expression, 'neutral')
  assert.equal(h.get().pending?.candidates.length, 1, '조건 확인은 계속')
  assert.equal(h.get().inflightText, null)
  // react 실패 뒤 입력을 시작하면 parse 완료가 듣기 표정을 덮지 않는다
  const h2 = harness()
  h2.dispatch({ type: 'submit', requestId: 'r-1', text: '월세 60 이하로' })
  h2.dispatch({ type: 'reactFail', requestId: 'r-1' })
  h2.dispatch({ type: 'typing', at: h2.fc.clock.now() })
  h2.dispatch({ type: 'parseOk', requestId: 'r-1', response: parsed('monthly_budget_krw', 600000) })
  assert.equal(h2.get().characterState, 'listening')
})

check('R1-04 enum 밖 표정도 parse 완료 전에 neutral, 낡은 요청의 실패는 무시', () => {
  const s = run(
    fresh(),
    { type: 'submit', requestId: 'r-1', text: 'x' },
    { type: 'reactOk', requestId: 'r-1', expressionId: 'smirk', confidence: 0.99 },
  )
  assert.equal(s.parseDone, false)
  assert.equal(s.expression, 'neutral')
  const stale = run(
    fresh(),
    { type: 'submit', requestId: 'r-1', text: 'a' },
    { type: 'submit', requestId: 'r-2', text: 'b' },
  )
  assert.equal(chatReducer(stale, { type: 'reactFail', requestId: 'r-1' }), stale)
})

if (failed) {
  console.log(`\n${failed}건 실패`)
  process.exit(1)
}
console.log('\n모두 통과')
