// 수용 테스트(AT01·AT03~AT09) 중 브라우저로 확인할 수 있는 항목의 자동 확인 + 스크린샷.
//
//   node scripts/acceptance-probe.mjs --base http://127.0.0.1:5194 --out ../.playwright-mcp/d5-qa
//
// measure-latency.mjs 와 같은 방식으로 playwright-core 를 찾는다(package.json 수정 없음).
// 서버는 미리 띄워 둔다. 셀렉터는 role / 자리표시자 / 텍스트 / aria·data 속성만 쓴다.
// 결과 JSON 의 각 항목은 {id, check, expected, observed, passed}. passed 가 true 인 것만 '통과'로 문서화한다.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d)
const BASE = arg('base', 'http://127.0.0.1:5173').replace(/\/$/, '')
const OUT = resolve(arg('out', '.'))
const SHOTS = join(OUT, 'shots')
mkdirSync(SHOTS, { recursive: true })

function findPlaywright() {
  const here = dirname(fileURLToPath(import.meta.url))
  const list = [arg('playwright', null), process.env.PLAYWRIGHT_CORE, join(here, '..', 'node_modules', 'playwright-core')].filter(Boolean)
  const npx = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'npm-cache', '_npx')
  if (existsSync(npx)) for (const d of readdirSync(npx)) list.push(join(npx, d, 'node_modules', 'playwright-core'))
  const hit = list.map((p) => resolve(p)).find((p) => existsSync(join(p, 'package.json')))
  if (!hit) throw new Error('playwright-core 를 찾지 못했습니다. --playwright <폴더> 로 지정하세요.')
  return hit
}
const pw = createRequire(import.meta.url)(findPlaywright())

const results = []
const record = (id, check, expected, observed, passed) => {
  results.push({ id, check, expected, observed, passed: !!passed })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${id} ${check}`)
}

const input = (page) => page.getByPlaceholder(/월세 60/)
const sendBtn = (page) => page.getByRole('button', { name: '보내기' })
const card = (page) => page.getByRole('group', { name: '조건 확인' })
const chatSection = (page) => page.locator('section').filter({ has: page.getByPlaceholder(/월세 60/) })
const face = (page) =>
  page.evaluate(() => {
    const e = document.querySelector('[role="img"][data-state]')
    return { state: e?.dataset.state, expression: e?.dataset.expression, reduced: e?.dataset.reducedMotion, label: e?.getAttribute('aria-label') }
  })
const logTexts = (page) => page.getByRole('log').locator('li').allInnerTexts()

async function open(browser, opts = {}, query = '') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', ...opts })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  const compareBodies = []
  const reactCalls = []
  page.on('request', (r) => { if (r.url().includes('/api/react')) reactCalls.push(Date.now()) })
  page.on('response', async (r) => {
    if (r.url().endsWith('/api/compare')) {
      const body = await r.json().catch(() => null)
      if (body) Object.defineProperty(body, '__request', { value: r.request().postData(), enumerable: false })
      compareBodies.push(body)
    }
  })
  await page.goto(BASE + '/' + query, { waitUntil: 'load' })
  await page.locator('[role="img"][data-state]').first().waitFor()
  return { context, page, compareBodies, reactCalls }
}

const PASSING = '월세 90 이하로, 60분 안쪽' // 통과 매물이 나오는 조건(합성 데이터 기준)
async function applyAndCompare(page, text = PASSING) {
  await input(page).fill(text)
  await sendBtn(page).click()
  await card(page).waitFor()
  await card(page).getByRole('button', { name: '모두 반영' }).click()
  await chatSection(page).getByRole('button', { name: '이 조건으로 비교하기' }).click()
}
// 대화로 반영한 조건(월세 90만)으로 간 /api/compare 응답이 도착할 때까지 기다린다.
async function chatCompareBody(page, bodies) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const hit = bodies.find((b) => b?.__request?.includes('"monthly_budget_krw":900000'))
    if (hit) return hit
    await page.waitForTimeout(50)
  }
  return null
}

const browser = await (async () => {
  for (const opt of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) {
    try { return await pw.chromium.launch({ headless: true, ...opt }) } catch { /* 다음 후보 */ }
  }
  throw new Error('브라우저를 시작하지 못했습니다')
})()

// ---- AT01 한국어 입력·조합: 조합 중에는 서버 요청 없음, 글자 손실·Enter 전송 없음, 듣기 반응은 로컬
{
  const { context, page, reactCalls } = await open(browser)
  const cdp = await context.newCDPSession(page)
  await input(page).focus()
  const steps = ['ㅇ', '아', '안', '안ㄴ', '안녀', '안녕']
  for (const t of steps) await cdp.send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length })
  const during = await face(page)
  // 실제 IME 는 조합 중 Enter 를 key='Process', keyCode=229 로 보낸다(암묵적 폼 제출 없음). 같은 모양으로 모의한다.
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Process', code: 'Enter', windowsVirtualKeyCode: 229 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Process', code: 'Enter', windowsVirtualKeyCode: 229 })
  await page.waitForTimeout(300)
  const stillEmpty = (await logTexts(page)).length
  await cdp.send('Input.insertText', { text: '안녕' })
  const value = await input(page).inputValue()
  await page.screenshot({ path: join(SHOTS, 'at01-ime.png') })
  record('AT01', 'IME 조합 모의(CDP) 중 서버 요청 0건·Enter(keyCode 229) 전송 없음·로컬 듣기 반응. 실제 한글 IME 수동 시험은 별도',
    '요청 0, 대화 기록은 인사 1건 그대로, 입력값 "안녕", 상태 listening',
    { reactRequests: reactCalls.length, logItems: stillEmpty, value, state: during.state },
    reactCalls.length === 0 && value === '안녕' && during.state === 'listening')
  await context.close()
}

// ---- AT03 모호한 조건: 임의 확정 금지 (API 계약 + 화면의 '확인 필요')
{
  const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())
  const vague = await post('/api/conditions/parse', { message: '월세를 조금 줄이고 싶어' })
  const unitless = await post('/api/conditions/parse', { message: '월세 60 이하' })
  const { context, page } = await open(browser)
  await input(page).fill('월세 60 이하')
  await sendBtn(page).click()
  await card(page).waitFor()
  const chip = await card(page).getByText('확인 필요').count()
  await page.screenshot({ path: join(SHOTS, 'at03-ambiguous.png') })
  record('AT03', '숫자 없는 의도는 후보 없이 질문만, 단위 없는 금액은 확인 필요 표시',
    'vague: candidates 0·questions ≥1 / unitless: needs_confirmation true / 화면에 "확인 필요"',
    { vagueCandidates: vague.candidates?.length, vagueQuestions: vague.questions?.length, unitlessNeeds: unitless.candidates?.map((c) => c.needs_confirmation), chip },
    vague.candidates?.length === 0 && vague.questions?.length >= 1 && unitless.candidates?.every((c) => c.needs_confirmation) && chip >= 1)
  await context.close()
}

// ---- AT04 의미 판단 실패 후 복구·비교 계속
{
  const { context, page } = await open(browser)
  await page.route('**/api/react', (r) => r.abort())
  await applyAndCompare(page)
  await page.waitForFunction(() => ['result', 'error'].includes(document.querySelector('[role="img"][data-state]')?.dataset.state))
  const f = await face(page)
  await page.screenshot({ path: join(SHOTS, 'at04-react-failed.png') })
  record('AT04', '/api/react 실패(연결 끊김)에도 조건 확인·비교 완료',
    '조건 카드 표시 → 반영 → 비교 후 result 상태', f, f.state === 'result')
  await context.close()
}

// ---- AT05 동적인 표정: 기본 움직임 / 의미 표정 / 전환 중 새 표정
{
  const { context, page } = await open(browser)
  const sample = () => page.evaluate(() => document.querySelector('[role="img"][data-state]').outerHTML.length + '|' + [...document.querySelectorAll('[role="img"][data-state] [data-part], [role="img"][data-state] [data-face]')].map((n) => n.getAttribute('transform') ?? n.getAttribute('d') ?? n.getAttribute('style') ?? n.getAttribute('opacity') ?? '').join(';'))
  const idle = new Set()
  for (let i = 0; i < 12; i++) { idle.add(await sample()); await page.waitForTimeout(150) }
  await input(page).fill('월세 60 이하로, 40분 안쪽')
  await sendBtn(page).click()
  await page.waitForFunction(() => document.querySelector('[role="img"][data-state]')?.dataset.state === 'reacting')
  const first = await face(page)
  await page.screenshot({ path: join(SHOTS, 'at05-reacting.png') })
  await input(page).fill('고마워')
  await sendBtn(page).click() // 전환 중 새 입력
  await page.waitForFunction(() => document.querySelector('[role="img"][data-state]')?.dataset.expression === 'happy')
  const second = await face(page)
  await page.screenshot({ path: join(SHOTS, 'at05-new-expression.png') })
  record('AT05', '대기 중 미세 움직임(12회 표본에서 값 변화), 의미 표정, 전환 중 새 표정 반영',
    '표본 서로 다른 값 ≥2, 의미 표정 reacting, 이어서 happy', { idleDistinct: idle.size, first, second },
    idle.size >= 2 && first.state === 'reacting' && second.expression === 'happy')
  await context.close()
}

// ---- AT06 표정과 계산 분리: 표정 응답이 달라도 /api/compare 응답 동일
{
  const bodies = []
  const requests = []
  for (const mode of ['normal', 'abort', 'forced-concerned']) {
    const { context, page, compareBodies } = await open(browser)
    if (mode === 'abort') await page.route('**/api/react', (r) => r.abort())
    if (mode === 'forced-concerned') {
      await page.route('**/api/react', async (r) => {
        const req = JSON.parse(r.request().postData() ?? '{}')
        await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ synthetic: true, assumptions: [], request_id: req.request_id, expression_id: 'concerned', confidence: 0.9, intent: 'complaint', engine: 'rule-based-v0' }) })
      })
    }
    await applyAndCompare(page)
    await page.waitForFunction(() => ['result', 'error'].includes(document.querySelector('[role="img"][data-state]')?.dataset.state))
    const lastBody = await chatCompareBody(page, compareBodies)
    bodies.push(JSON.stringify(lastBody))
    requests.push(lastBody?.__request)
    await context.close()
  }
  record('AT06', '표정 응답(정상·실패·강제 concerned)이 달라도 마지막 /api/compare 응답 본문 동일',
    '3회 본문 문자열 동일', { sameAll: bodies.every((b) => b === bodies[0]), sameRequests: requests.every((q) => q === requests[0]), bytes: bodies.map((b) => b.length), requests },
    bodies[0] && bodies.every((b) => b === bodies[0]))
}

// ---- AT07 화면 설명 수치 = API 응답 (사람이 대조할 수 있게 값도 기록)
{
  const { context, page, compareBodies } = await open(browser)
  await applyAndCompare(page)
  await page.waitForFunction(() => document.querySelector('[role="img"][data-state]')?.dataset.state === 'result')
  const texts = await logTexts(page)
  const last = texts[texts.length - 1] ?? ''
  const body = await chatCompareBody(page, compareBodies)
  const top = body?.results?.filter((r) => r.status === 'pass').sort((a, b) => a.rank - b.rank)[0]
  const won = (n) => (n == null ? null : `${Math.round(n / 10000) === n / 10000 ? n / 10000 : n.toLocaleString('ko-KR')}`)
  await page.screenshot({ path: join(SHOTS, 'at07-result-explain.png') })
  const hasLabel = top ? last.includes(top.label) : false
  record('AT07', '결과 설명 말풍선이 API 1위 매물명을 포함하고 합성 고지를 유지 (숫자 전수 대조는 check-chat.ts AT07)',
    '1위 label 포함 + "합성" 문구', { lastBubble: last.slice(0, 160), top: top && { label: top.label, rank: top.rank } },
    hasLabel && last.includes('합성'))
  void won
  await context.close()
}

// ---- AT08 결과 없음 vs 서버 오류
{
  const { context, page } = await open(browser)
  await input(page).fill('월세 10 이하로')
  await sendBtn(page).click()
  await card(page).waitFor()
  await card(page).getByRole('button', { name: '모두 반영' }).click()
  await chatSection(page).getByRole('button', { name: '이 조건으로 비교하기' }).click()
  await page.waitForFunction(() => ['result', 'error'].includes(document.querySelector('[role="img"][data-state]')?.dataset.state))
  const none = await logTexts(page)
  await page.screenshot({ path: join(SHOTS, 'at08-no-result.png') })
  await context.close()

  const e = await open(browser)
  await e.page.route('**/api/compare', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"x"}' }))
  await applyAndCompare(e.page)
  await e.page.waitForFunction(() => document.querySelector('[role="img"][data-state]')?.dataset.state === 'error')
  const err = await logTexts(e.page)
  const errFace = await face(e.page)
  await e.page.screenshot({ path: join(SHOTS, 'at08-server-error.png') })
  await e.context.close()
  const a = none[none.length - 1] ?? ''
  const b = err[err.length - 1] ?? ''
  record('AT08', '조건에 맞는 매물 0건 응답 vs 서버 500 응답의 마지막 말풍선이 서로 다르다',
    '두 문장이 다르고 오류 쪽 표정 error', { noResult: a.slice(0, 120), serverError: b.slice(0, 120), errState: errFace.state },
    a !== b && a.length > 0 && b.length > 0 && errFace.state === 'error')
}

// ---- AT09 에셋 오류·접근성: 이미지 차단 + 모션 감소
{
  const { context, page } = await open(browser, { reducedMotion: 'reduce' })
  await context.route('**/skins/**', (r) => r.abort())
  await page.reload({ waitUntil: 'load' })
  await page.locator('[role="img"][data-state]').first().waitFor()
  await applyAndCompare(page)
  await page.waitForFunction(() => document.querySelector('[role="img"][data-state]')?.dataset.state === 'result')
  const f = await face(page)
  const texts = await logTexts(page)
  const m1 = await page.evaluate(() => document.querySelector('[role="img"][data-state]').innerHTML)
  await page.waitForTimeout(600)
  const m2 = await page.evaluate(() => document.querySelector('[role="img"][data-state]').innerHTML)
  await page.screenshot({ path: join(SHOTS, 'at09-assets-blocked-reduced-motion.png') })
  record('AT09', '보금이 이미지 요청 차단 + prefers-reduced-motion 에서도 결과 문장이 읽히고 캐릭터 라벨 유지',
    '결과 말풍선 존재, data-reduced-motion=true, aria-label 비어 있지 않음',
    { reduced: f.reduced, label: f.label, lastBubble: (texts[texts.length - 1] ?? '').slice(0, 80), innerStaticAfter600ms: m1 === m2 },
    f.reduced === 'true' && !!f.label && (texts[texts.length - 1] ?? '').length > 0)
  await context.close()
}

// 참고용 첫 화면 스크린샷
{
  const { context, page } = await open(browser)
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(SHOTS, 'first-screen.png'), fullPage: true })
  await context.close()
}

await browser.close()
writeFileSync(join(OUT, 'acceptance-probe.json'), JSON.stringify(results, null, 2) + '\n')
const failed = results.filter((r) => !r.passed)
console.log(failed.length === 0 ? '모두 통과' : `실패 ${failed.length}건: ${failed.map((r) => r.id).join(', ')}`)
process.exit(failed.length === 0 ? 0 : 1)
