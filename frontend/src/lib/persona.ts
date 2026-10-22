// 대화 캐릭터의 이름·말투. 화면·네트워크에 의존하지 않아 node 로 바로 검사한다.
// 보금이는 문장 앞 감탄사를 붙이고 모든 문장을 반말로 맞춘다. 숫자·매물명·비용·따옴표 안 원문은 바꾸지 않는다.

export type PersonaId = 'renti' | 'bogeum'

/** 대화 단계. 보금이 말투는 이 단계에 맞는 감탄사를 문장 앞에 붙인다. */
export type VoiceCue =
  | 'confirm'
  | 'applied'
  | 'question'
  | 'not_understood'
  | 'comparing'
  | 'result_pass'
  | 'result_none'
  | 'server_error'
  | 'cancel'

export type PersonaStatus = 'idle' | 'listening' | 'thinking' | 'reacting' | 'comparing' | 'result' | 'error'

/** 고정 안내 문장. 숫자·매물명이 든 결과 설명은 여기가 아니라 explain.ts 가 만든다. */
export type PersonaLines = {
  confirm: string
  applied: (names: string) => string
  cancelled: (names: string) => string
  notUnderstood: (original: string) => string
  parseFail: string
  invalid: (errors: string[]) => string
}

export type Persona = {
  id: PersonaId
  name: string
  greeting: string
  panelTitle: string
  logLabel: string
  inputLabel: string
  statusLabels: Readonly<Record<PersonaStatus, string>>
  lines: PersonaLines
  /** explain.ts 문장 틀과 서버 메모 변환에 쓴다. 렌티는 존댓말, 보금이는 반말. */
  tone: 'polite' | 'casual'
  voice: (text: string, cue: VoiceCue) => string
}

export const RENTI: Persona = {
  id: 'renti',
  name: '렌티',
  greeting: '안녕하세요, 렌티예요. 원하는 조건을 편하게 말해 주세요. 예: “월세 60 이하로, 40분 안쪽”',
  panelTitle: '렌티와 대화로 조건 정하기',
  logLabel: '렌티와 나눈 대화',
  inputLabel: '렌티에게 조건 말하기',
  statusLabels: {
    idle: '렌티가 기다리고 있어요',
    listening: '렌티가 입력을 듣고 있어요',
    thinking: '렌티가 생각하고 있어요',
    reacting: '렌티가 반응하고 있어요',
    comparing: '렌티가 비교 결과를 기다리고 있어요',
    result: '렌티가 결과를 전하고 있어요',
    error: '렌티가 오류를 알리고 있어요',
  },
  lines: {
    confirm: '이렇게 이해했어요. 맞는지 확인하고 반영해 주세요. 확인 전에는 조건을 바꾸지 않아요.',
    applied: (names) => `${names} 조건을 왼쪽 폼에 반영했어요. 준비되면 ‘이 조건으로 비교하기’를 눌러 주세요.`,
    cancelled: (names) => `${names} 조건은 반영하지 않았어요. 기존 조건은 그대로예요.`,
    notUnderstood: (original) =>
      `정확히 이해하지 못했어요. 입력하신 내용은 그대로 두었어요: “${original}”\n왼쪽 ‘내 조건’에서 직접 수정해 주세요.`,
    parseFail: '조건을 해석하는 서버에 연결하지 못했어요. 왼쪽 ‘내 조건’에서 직접 입력하거나 다시 보내 주세요.',
    invalid: (errors) => `비교할 수 없어요. ${errors.join(' ')}`,
  },
  tone: 'polite',
  voice: (text) => text,
}

// 보금이 말 사전: 알겠어=콩, 반영했어=콩콩, 뭐지=갸웃, 엥?뭐야=엥엥, 가보자=총총총, 찾았다=짠, 아쉽다=으앗, 큰일났다=으아앙, 그렇구나=흐흥
const BOGEUM_INTERJECTION: Readonly<Record<VoiceCue, string>> = {
  confirm: '콩! ',
  applied: '콩콩! ',
  question: '갸웃? ',
  not_understood: '엥엥? ',
  comparing: '총총총! ',
  result_pass: '짠! ',
  result_none: '으앗.. ',
  server_error: '으아앙.. ',
  cancel: '흐흥~ ',
}

// 보금이는 모든 대화 단계에서 반말이다. explain.ts 의 casual 문장은 템플릿으로 직접 쓰고,
// 서버가 준 질문·메모(backend 계약은 그대로)는 여기서 어미만 바꾼다. 숫자와 따옴표 안 원문은 건드리지 않는다.
const QUOTED = /(“[^”]*”|‘[^’]*’|"[^"]*")/
// 문장 끝(마침표·물음표·느낌표·쉼표·괄호·공백·문자열 끝) 앞에서만 어미로 본다.
const END = '(?=[.!?,)\\s]|$)'
type Replacer = string | ((match: string, prev: string) => string)
const rule = (pattern: string, to: Replacer): readonly [RegExp, Replacer] => [new RegExp(pattern + END, 'g'), to]
const hasFinalConsonant = (ch: string) => (ch.charCodeAt(0) - 0xac00) % 28 !== 0
const FINAL_B = 17

const CASUAL_RULES: ReadonlyArray<readonly [RegExp, Replacer]> = [
  rule('아니에요', '아니야'),
  rule('주세요', '줘'),
  rule('([았었했랐렀겠있없])습니다', '$1어'),
  rule('([가-힣])([어아])요', '$1$2'),
  rule('해요', '해'),
  rule('않습니다', '않아'),
  rule('합니다', '해'),
  rule('([가-힣])입니다', (_m, prev) => (hasFinalConsonant(prev) ? `${prev}이야` : `${prev}야`)),
  rule('이에요', '이야'),
  rule('(에|예)요', '야'),
  rule('까요', '까'),
  // 벗어납니다·갑니다처럼 ㅂ받침 + 니다: 받침을 떼면 반말 기본형(벗어나·가)이 된다.
  rule('([가-힣])니다', (m, prev) => {
    const code = prev.charCodeAt(0) - 0xac00
    return code % 28 === FINAL_B ? String.fromCharCode(prev.charCodeAt(0) - FINAL_B) : m
  }),
]

/**
 * 존댓말 어미를 반말로 바꾼다. 숫자가 든 문장도 바꾸되 숫자 토큰과 따옴표 안 원문은 그대로 둔다.
 * 규칙에 없는 어미는 그대로 남으므로 새 서버 문구가 생기면 check-chat.ts 의 dialogue.py 표 검사가 알려 준다.
 */
export function casualize(text: string): string {
  return text
    .split(QUOTED)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : CASUAL_RULES.reduce((t, [re, to]) => (typeof to === 'string' ? t.replace(re, to) : t.replace(re, to)), part),
    )
    .join('')
}

export const BOGEUM: Persona = {
  id: 'bogeum',
  name: '보금이',
  greeting: '짠! 보금이야. 원하는 조건 편하게 말해 줘! 예: “월세 60 이하로, 40분 안쪽”',
  panelTitle: '보금이와 대화로 조건 정하기',
  logLabel: '보금이와 나눈 대화',
  inputLabel: '보금이에게 조건 말하기',
  statusLabels: {
    idle: '보금이가 기다리는 중',
    listening: '보금이가 쫑긋 듣는 중',
    thinking: '갸웃? 생각하는 중',
    reacting: '보금이가 반응하는 중',
    comparing: '총총총! 비교 결과 기다리는 중',
    result: '보금이가 결과를 알려 주는 중',
    error: '으아앙.. 오류를 알리는 중',
  },
  lines: {
    confirm: '이렇게 이해했어. 맞는지 확인하고 반영해 줘. 확인 전에는 조건 안 바꿀게!',
    applied: (names) => `${names} 조건을 왼쪽 폼에 반영했어. 준비되면 ‘이 조건으로 비교하기’를 눌러 줘!`,
    cancelled: (names) => `${names} 조건은 반영 안 했어. 기존 조건은 그대로야.`,
    notUnderstood: (original) =>
      `잘 모르겠어. 입력한 내용은 그대로 뒀어: “${original}”\n왼쪽 ‘내 조건’에서 직접 수정해 줘.`,
    parseFail: '조건을 해석하는 서버에 연결 못 했어. 왼쪽 ‘내 조건’에서 직접 입력하거나 다시 보내 줘.',
    invalid: (errors) => `비교 못 해. ${errors.join(' ')}`,
  },
  tone: 'casual',
  // 보금이 말 사전 형식: "감탄사 (뜻)". 뜻은 모든 cue 에서 반말로 맞춘다(이미 반말이면 그대로).
  voice: (text, cue) => `${BOGEUM_INTERJECTION[cue].trimEnd()} (${casualize(text)})`,
}

/**
 * 스킨 판별은 여기 한 곳. 쿼리가 없으면 보금이(기본 캐릭터), ?skin=renti 일 때만 렌티.
 * 캐릭터 이미지와 대화 말투가 같은 규칙을 쓴다.
 */
export function personaIdFromSearch(search: string): PersonaId {
  return new URLSearchParams(search).get('skin') === 'renti' ? 'renti' : 'bogeum'
}

export function mascotSkinRequested(): boolean {
  const search = typeof window === 'undefined' ? '' : window.location.search
  return personaIdFromSearch(search) === 'bogeum'
}

export function currentPersona(): Persona {
  return mascotSkinRequested() ? BOGEUM : RENTI
}
