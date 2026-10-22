// 대화 입력·캐릭터 반응 지연 측정 (기능명세 12장). 의존성 추가 없이 실행한다.
//
//   node scripts/measure-latency.mjs --base http://127.0.0.1:5194 --n 30 --out ../.playwright-mcp/d5-qa
//
// 서버(백엔드)와 프론트(vite)는 미리 띄워 둔다. 이 스크립트는 띄우지도 종료하지도 않는다.
// playwright-core 는 package.json 에 없다. 순서대로 찾는다:
//   1) --playwright <경로> 또는 환경변수 PLAYWRIGHT_CORE (playwright-core 폴더)
//   2) 프론트의 node_modules, 전역 node_modules
//   3) npx 캐시(%LOCALAPPDATA%\npm-cache\_npx\*\node_modules\playwright-core)
// 셀렉터는 role / 자리표시자 / 텍스트 / aria 속성 / data 속성만 쓴다(클래스 의존 금지).
//
// 측정 항목
//   local_ms    : 입력창 keydown → 캐릭터 data-state 가 'listening' 으로 바뀐 시각 (서버 무관)
//   thinking_ms : 전송 버튼 클릭 → data-state 'thinking'
//   semantic_ms : 전송 버튼 클릭 → data-state 'reacting' (의미 표정이 나타난 시각)
//   react_api_ms: /api/react 요청 → 응답 끝 (브라우저가 본 시간)
//   parse_api_ms: /api/conditions/parse 요청 → 응답 끝
//   compare_ui_ms : '이 조건으로 비교하기' 클릭 → data-state 'result' 또는 'error'
//   compare_api_ms: /api/compare 요청 → 응답 끝
//   stale       : 첫 요청을 지연시켜 응답 순서를 뒤집었을 때 최신 응답만 남는지

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, platform, release, cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = parseArgs(process.argv.slice(2))
const BASE = (args.base ?? 'http://127.0.0.1:5173').replace(/\/$/, '')
const N = Number(args.n ?? 30)
const STALE_N = Number(args.stale ?? Math.min(N, 10))
const OUT = resolve(args.out ?? '.')
const SKIN = args.skin ? `?skin=${args.skin}` : ''
const STEP_TIMEOUT = 8000
const STALE_DELAY_MS = 1000
const A_TEXT = '월세 60 이하로, 40분 안쪽' // 조건 후보가 나오는 입력
const B_TEXT = '고마워' // 표정이 A 와 다른 입력

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
  }
  return out
}

function findPlaywright() {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = []
  if (args.playwright) candidates.push(resolve(args.playwright))
  if (process.env.PLAYWRIGHT_CORE) candidates.push(resolve(process.env.PLAYWRIGHT_CORE))
  candidates.push(join(here, '..', 'node_modules', 'playwright-core'))
  const npx = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'npm-cache', '_npx')
  if (existsSync(npx)) {
    for (const d of readdirSync(npx)) candidates.push(join(npx, d, 'node_modules', 'playwright-core'))
  }
  for (const c of candidates) {
    if (existsSync(join(c, 'package.json'))) return c
  }
  throw new Error('playwright-core 를 찾지 못했습니다. --playwright <playwright-core 폴더> 로 지정하세요.')
}

const pwDir = findPlaywright()
const require = createRequire(import.meta.url)
const pw = require(pwDir)
const pwVersion = require(join(pwDir, 'package.json')).version

// ---------- 통계 ----------
function pct(sorted, p) {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}
function stats(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return { n: 0, min: null, median: null, p90: null, max: null }
  const mid = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2
  return { n: v.length, min: round(v[0]), median: round(mid), p90: round(pct(v, 90)), max: round(v[v.length - 1]) }
}
const round = (x) => Math.round(x * 10) / 10

// ---------- 화면 조작 (role / 텍스트 기반) ----------
const CHAR = '[role="img"][data-state]'

async function openPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' })
  const page = await context.newPage()
  page.setDefaultTimeout(STEP_TIMEOUT)
  const net = { api: [], httpErrors: [], failed: [] }
  page.on('requestfinished', async (req) => {
    const url = new URL(req.url())
    if (!url.pathname.startsWith('/api/')) return
    const res = await req.response()
    const t = req.timing()
    net.api.push({ path: url.pathname, status: res?.status() ?? 0, ms: t.responseEnd >= 0 ? t.responseEnd : null, at: Date.now() })
    if (res && res.status() >= 400) net.httpErrors.push({ path: url.pathname, status: res.status() })
  })
  page.on('requestfailed', (req) => {
    if (new URL(req.url()).pathname.startsWith('/api/')) net.failed.push(new URL(req.url()).pathname)
  })
  await page.addInitScript(() => {
    window.__t = {}
    window.__w = {}
    document.addEventListener('keydown', (e) => { if (e.target instanceof HTMLInputElement) window.__t.keydown = performance.now() }, true)
    document.addEventListener('click', () => { window.__t.click = performance.now() }, true)
    // 캐릭터 속성이 조건을 만족하는 첫 시각(performance.now). t0 보다 이후여야 한다.
    window.__arm = (name, states, since) => {
      window.__w[name] = new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('timeout ' + name)), 8000)
        const check = () => {
          const el = document.querySelector('[role="img"][data-state]')
          if (!el || !states.includes(el.dataset.state)) return false
          const t = performance.now()
          if (t < window.__t[since]) return false
          clearTimeout(timer)
          res({ t, state: el.dataset.state, expression: el.dataset.expression })
          return true
        }
        const start = () => {
          const el = document.querySelector('[role="img"][data-state]')
          if (!el) return setTimeout(start, 20)
          new MutationObserver((_, obs) => { if (check()) obs.disconnect() }).observe(el, { attributes: true, attributeFilter: ['data-state', 'data-expression'] })
        }
        start()
      })
      window.__w[name].catch(() => {})
    }
  })
  await page.goto(BASE + '/' + SKIN, { waitUntil: 'load' })
  await page.locator(CHAR).first().waitFor()
  return { context, page, net }
}

const input = (page) => page.getByPlaceholder(/월세 60/)
const sendButton = (page) => page.getByRole('button', { name: '보내기' })
const chatSection = (page) => page.locator('section').filter({ has: page.getByPlaceholder(/월세 60/) })

async function measureOnce(browser, i) {
  const rec = { i, errors: [] }
  const { context, page, net } = await openPage(browser)
  try {
    const box = input(page)
    await box.waitFor()

    // 1) 로컬 반응: keydown → 듣기
    try {
      await page.evaluate(() => window.__arm('listen', ['listening'], 'keydown'))
      await box.focus()
      await page.keyboard.press('KeyW')
      const r = await page.evaluate(() => window.__w.listen)
      rec.local_ms = round(r.t - (await page.evaluate(() => window.__t.keydown)))
    } catch (e) { rec.errors.push('local: ' + e.message) }

    // 2) 의미 반응: 전송 클릭 → thinking / reacting
    try {
      await box.fill(A_TEXT)
      await page.evaluate(() => {
        window.__arm('think', ['thinking'], 'click')
        window.__arm('react', ['reacting'], 'click')
      })
      await sendButton(page).click()
      const t0 = await page.evaluate(() => window.__t.click)
      const react = await page.evaluate(() => window.__w.react)
      rec.semantic_ms = round(react.t - t0)
      rec.expression = react.expression
      const think = await page.evaluate(() => window.__w.think.then((x) => x, () => null))
      if (think) rec.thinking_ms = round(think.t - t0)
    } catch (e) { rec.errors.push('semantic: ' + e.message) }

    // 3) 확인 카드 → 모두 반영 → 비교
    try {
      const card = page.getByRole('group', { name: '조건 확인' })
      await card.waitFor()
      await card.getByRole('button', { name: '모두 반영' }).click()
      const compare = chatSection(page).getByRole('button', { name: '이 조건으로 비교하기' })
      await compare.waitFor()
      await page.evaluate(() => window.__arm('cmp', ['result', 'error'], 'click'))
      await compare.click()
      const t0 = await page.evaluate(() => window.__t.click)
      const done = await page.evaluate(() => window.__w.cmp)
      rec.compare_ui_ms = round(done.t - t0)
      rec.compare_final_state = done.state
      if (done.state === 'error') rec.errors.push('compare: 화면이 오류 상태')
    } catch (e) { rec.errors.push('compare: ' + e.message) }

    await page.waitForTimeout(150)
    const pick = (path) => net.api.filter((x) => x.path === path).map((x) => x.ms)
    rec.react_api_ms = pick('/api/react')[0] != null ? round(pick('/api/react')[0]) : null
    rec.parse_api_ms = pick('/api/conditions/parse')[0] != null ? round(pick('/api/conditions/parse')[0]) : null
    // 첫 화면 자동 비교(페이지 로드)가 앞에 있을 수 있어 마지막 /api/compare 를 쓴다.
    const cmp = pick('/api/compare')
    rec.compare_api_ms = cmp.length ? round(cmp[cmp.length - 1]) : null
    rec.api_requests = net.api.length
    rec.http_errors = net.httpErrors
    rec.request_failed = net.failed
  } catch (e) {
    rec.errors.push('fatal: ' + e.message)
  } finally {
    await context.close()
  }
  return rec
}

// ---------- 오래된 응답 무시 ----------
async function staleOnce(browser, i) {
  const rec = { i, errors: [] }
  const { context, page } = await openPage(browser)
  try {
    const seen = [] // 응답이 브라우저에 도착한 순서
    const counters = { '/api/react': 0, '/api/conditions/parse': 0 }
    for (const path of Object.keys(counters)) {
      await page.route('**' + path, async (route) => {
        counters[path] += 1
        if (counters[path] === 1) await new Promise((r) => setTimeout(r, STALE_DELAY_MS)) // 첫 요청(A)만 지연 (react 시간 제한 1.5초보다 짧게)
        await route.continue()
      })
    }
    page.on('response', async (res) => {
      const u = new URL(res.url())
      if (u.pathname !== '/api/react') return
      try {
        const body = await res.json()
        seen.push({ request_id: body.request_id, expression_id: body.expression_id, confidence: body.confidence, at: Date.now() })
      } catch { /* 본문이 없으면 건너뜀 */ }
    })
    const box = input(page)
    await box.fill(A_TEXT)
    await sendButton(page).click() // A: 지연됨
    await page.waitForTimeout(80)
    await box.fill(B_TEXT)
    await sendButton(page).click() // B: 즉시 응답
    const deadline = Date.now() + 6000
    while (seen.length < 2 && Date.now() < deadline) await page.waitForTimeout(50)
    await page.waitForTimeout(300) // A 의 지연 응답이 도착한 직후 상태를 본다
    const els = await page.evaluate(() => {
      const el = document.querySelector('[role="img"][data-state]')
      return { state: el?.dataset.state, expression: el?.dataset.expression }
    })
    const cardVisible = await page.getByRole('group', { name: '조건 확인' }).count()
    rec.arrival_order = seen.map((s) => s.expression_id)
    const num = (id) => Number(String(id).replace(/\D/g, ''))
    rec.reversed = seen.length === 2 && num(seen[0].request_id) > num(seen[1].request_id)
    rec.final_expression = els.expression
    rec.final_state = els.state
    rec.card_visible = cardVisible
    // 최신(B)의 표정이 유지되고(또는 대기로 복귀), A 의 표정·후보 카드는 나타나지 않아야 한다.
    const aExpr = seen.find((x) => num(x.request_id) === Math.min(...seen.map((y) => num(y.request_id))))?.expression_id
    rec.stale_card_ignored = cardVisible === 0
    rec.latest_kept = els.expression !== aExpr && (els.expression === 'happy' || els.state === 'idle')
    rec.pass = rec.reversed === true && rec.stale_card_ignored && rec.latest_kept
  } catch (e) {
    rec.errors.push('fatal: ' + e.message)
    rec.pass = false
  } finally {
    await context.close()
  }
  return rec
}

// ---------- 표정 서버 지연(1.5초 초과) 복구 ----------
async function timeoutOnce(browser, i) {
  const rec = { i, errors: [] }
  const { context, page } = await openPage(browser)
  try {
    await page.route('**/api/react', async (route) => {
      await new Promise((r) => setTimeout(r, 2200))
      await route.continue().catch(() => {})
    })
    await input(page).fill(A_TEXT)
    await sendButton(page).click()
    const card = page.getByRole('group', { name: '조건 확인' })
    await card.waitFor() // 표정이 늦어도 조건 해석은 계속된다
    rec.card_shown = true
    await page.waitForTimeout(1900)
    const el = await page.evaluate(() => {
      const e = document.querySelector('[role="img"][data-state]')
      return { state: e?.dataset.state, expression: e?.dataset.expression }
    })
    rec.final_expression = el.expression
    rec.final_state = el.state
    rec.pass = rec.card_shown === true && el.expression === 'neutral'
  } catch (e) {
    rec.errors.push('fatal: ' + e.message)
    rec.pass = false
  } finally {
    await context.close()
  }
  return rec
}

// ---------- 실행 ----------
async function launch() {
  const attempts = [{}, { channel: 'chrome' }, { channel: 'msedge' }]
  let lastErr
  for (const opt of attempts) {
    try {
      return await pw.chromium.launch({ headless: true, ...opt })
    } catch (e) { lastErr = e }
  }
  throw lastErr
}

const startedAt = new Date().toISOString()
const browser = await launch()
const browserVersion = browser.version()
const rows = []
for (let i = 1; i <= N; i++) {
  rows.push(await measureOnce(browser, i))
  process.stderr.write(`\r측정 ${i}/${N}`)
}
process.stderr.write('\n')
const staleRows = []
for (let i = 1; i <= STALE_N; i++) {
  staleRows.push(await staleOnce(browser, i))
  process.stderr.write(`\r역순 응답 ${i}/${STALE_N}`)
}
process.stderr.write('\n')
const timeoutRows = []
for (let i = 1; i <= 3; i++) timeoutRows.push(await timeoutOnce(browser, i))
await browser.close()

const col = (k) => rows.map((r) => r[k])
const failedRuns = rows.filter((r) => r.errors.length > 0 || r.http_errors?.length || r.request_failed?.length)
const result = {
  meta: {
    started_at: startedAt,
    base: BASE,
    skin: args.skin ?? '(기본)',
    repetitions: N,
    stale_repetitions: STALE_N,
    node: process.version,
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    cpu_count: cpus().length,
    browser: `chromium ${browserVersion} (headless)`,
    playwright_core: pwVersion,
    note: '로컬 루프백 측정. 실제 네트워크·저사양 기기와 다르다. 입력은 합성 문장.',
  },
  metrics: {
    local_ms: stats(col('local_ms')),
    thinking_ms: stats(col('thinking_ms')),
    semantic_ms: stats(col('semantic_ms')),
    react_api_ms: stats(col('react_api_ms')),
    parse_api_ms: stats(col('parse_api_ms')),
    compare_ui_ms: stats(col('compare_ui_ms')),
    compare_api_ms: stats(col('compare_api_ms')),
  },
  error_rate: {
    runs: N,
    failed_runs: failedRuns.length,
    ratio: N ? round((failedRuns.length / N) * 100) / 100 : null,
    http_errors: rows.flatMap((r) => r.http_errors ?? []).length,
    request_failed: rows.flatMap((r) => r.request_failed ?? []).length,
    step_errors: rows.flatMap((r) => r.errors),
  },
  stale: {
    runs: STALE_N,
    passed: staleRows.filter((r) => r.pass).length,
    detail: staleRows,
  },
  react_timeout: { runs: timeoutRows.length, passed: timeoutRows.filter((r) => r.pass).length, detail: timeoutRows },
  runs: rows,
}

mkdirSync(OUT, { recursive: true })
const jsonPath = join(OUT, 'latency-result.json')
const mdPath = join(OUT, 'latency-result.md')
writeFileSync(jsonPath, JSON.stringify(result, null, 2) + '\n')

const f = (s) => (s.n ? `${s.median} | ${s.p90} | ${s.max} | ${s.n}` : '- | - | - | 0')
const md = [
  `# 지연 측정 결과 (${startedAt})`,
  '',
  `- 서버: ${BASE} · 반복 ${N}회 · 브라우저 chromium ${browserVersion} · playwright-core ${pwVersion}`,
  `- OS: ${result.meta.os} · Node ${process.version} · CPU ${result.meta.cpu} (${result.meta.cpu_count} 스레드)`,
  '',
  '| 항목 | 중앙값(ms) | p90(ms) | 최대(ms) | 표본 |',
  '|---|---:|---:|---:|---:|',
  `| 입력(keydown)→듣기 반응 | ${f(result.metrics.local_ms)} |`,
  `| 전송→생각 표정 | ${f(result.metrics.thinking_ms)} |`,
  `| 전송→의미 표정 | ${f(result.metrics.semantic_ms)} |`,
  `| /api/react 응답 | ${f(result.metrics.react_api_ms)} |`,
  `| /api/conditions/parse 응답 | ${f(result.metrics.parse_api_ms)} |`,
  `| 비교 클릭→결과 상태 | ${f(result.metrics.compare_ui_ms)} |`,
  `| /api/compare 응답 | ${f(result.metrics.compare_api_ms)} |`,
  '',
  `- 오류: ${failedRuns.length}/${N}회 (HTTP 4xx·5xx ${result.error_rate.http_errors}건, 요청 실패 ${result.error_rate.request_failed}건)`,
  `- 오래된 응답 무시: ${result.stale.passed}/${STALE_N}회 통과 (첫 요청 ${STALE_DELAY_MS}ms 지연, 응답 역순 도착)`,
  `- 표정 서버 지연(2.2초, 시간 제한 1.5초) 복구: ${result.react_timeout.passed}/${result.react_timeout.runs}회 통과 (조건 카드는 표시, 표정은 neutral)`,
  '',
].join('\n')
writeFileSync(mdPath, md)
console.log(md)
console.log(`JSON: ${jsonPath}\nMarkdown: ${mdPath}`)
process.exit(failedRuns.length === 0 && result.stale.passed === STALE_N && result.react_timeout.passed === timeoutRows.length ? 0 : 1)
