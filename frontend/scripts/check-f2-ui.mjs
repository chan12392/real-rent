// 리뷰 R1-02·05·06·07 회귀 확인(브라우저). 서버는 미리 띄워 둔다.
//
//   node scripts/check-f2-ui.mjs --base http://127.0.0.1:5201 --out ../.playwright-mcp/f2-fix
//
// playwright-core 는 acceptance-probe.mjs 와 같은 방식으로 찾는다(package.json 수정 없음).
// 하나라도 실패하면 종료 코드 1.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d)
const BASE = arg('base', 'http://127.0.0.1:5173').replace(/\/$/, '')
const OUT = resolve(arg('out', '.'))
mkdirSync(OUT, { recursive: true })

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
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${id} ${check}\n      expected: ${expected}\n      observed: ${observed}`)
}

async function openL03(page) {
  await page.goto(BASE)
  await page.getByRole('button', { name: /^L03/ }).first().waitFor()
  await page.getByRole('button', { name: /^L03/ }).first().click()
  await page.locator('#detail-title').waitFor()
}

async function section(id, fn) {
  try {
    await fn()
  } catch (e) {
    record(id, '시나리오 실행', '예외 없이 완료', String(e.message).split('\n')[0], false)
  }
}

const browser = await (async () => {
  for (const opt of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) {
    try { return await pw.chromium.launch({ headless: true, ...opt }) } catch { /* 다음 후보 */ }
  }
  throw new Error('브라우저를 시작하지 못했습니다')
})()
try {
  // ── R1-02: 비유한 관리비 입력 ──────────────────────────────
  await section('R1-02-input', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
    const bodies = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/compare')) bodies.push(r.postData() ?? '')
    })
    await openL03(page)
    const before = bodies.length
    await page.getByPlaceholder('예: 60000').fill('9'.repeat(309))
    await page.getByRole('button', { name: '이 관리비로 다시 계산' }).click()
    await page.waitForTimeout(600)
    const msg = (await page.locator('.override .hint').first().innerText({ timeout: 1000 }).catch(() => '(입력 폼 없음)')).trim()
    const sent = bodies.slice(before).filter((b) => b.includes('management_overrides'))
    const errBox = await page.locator('.state-box.error').count()
    record('R1-02a', '9×309 입력 → 요청 미발송 + 입력란 오류', '요청 0건, 오류 상자 0, 안내문에 "너무" 또는 "이하"', `요청 ${sent.length}건, 오류상자 ${errBox}, 안내="${msg}"`, sent.length === 0 && errBox === 0 && /너무|이하|넘/.test(msg))
    await page.screenshot({ path: join(OUT, 'r1-02-input-error.png'), fullPage: false })

    // 상한 경계: 10,000,000 허용, 10,000,001 거부
    const before2 = bodies.length
    await page.getByPlaceholder('예: 60000').fill('10000001')
    await page.getByRole('button', { name: '이 관리비로 다시 계산' }).click()
    await page.waitForTimeout(500)
    const over = bodies.slice(before2).filter((b) => b.includes('management_overrides')).length
    record('R1-02b', '10,000,001 → 거부', '요청 0건', `요청 ${over}건`, over === 0)

    await page.getByPlaceholder('예: 60000').fill('60000')
    await page.getByRole('button', { name: '이 관리비로 다시 계산' }).click()
    const ok60 = await page.getByText(/직접 입력한 관리비 1건 반영 중/).waitFor({ timeout: 5000 }).then(() => true, () => false)
    record('R1-02c', '60000 → 정상 반영', '관리비 1건 반영 문구', ok60 ? '반영 문구 확인' : '반영 문구 없음(오류 상태 지속)', ok60)
    await page.close()
  })

  // ── R1-02: 비교가 오류로 끝나도 복구 경로 ───────────────────
  await section('R1-02-recovery', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
    await openL03(page)
    await page.getByPlaceholder('예: 60000').fill('60000')
    await page.route('**/api/compare', (route) => {
      const body = route.request().postData() ?? ''
      if (body.includes('management_overrides')) {
        return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: [{ msg: 'boom' }] }) })
      }
      return route.continue()
    })
    await page.getByRole('button', { name: '이 관리비로 다시 계산' }).click()
    await page.locator('.state-box.error').waitFor({ timeout: 5000 })
    const btn = page.getByRole('button', { name: /직접 입력한 관리비 모두 지우고 다시 시도/ })
    const has = await btn.count()
    record('R1-02d', '오류 상자에 덮어쓰기 해제 버튼', '버튼 1개', `${has}개`, has === 1)
    await page.screenshot({ path: join(OUT, 'r1-02-error-recovery.png') })
    if (has === 1) {
      await btn.click()
      await page.getByRole("heading", { name: /전체 12건 비교/ }).waitFor({ timeout: 5000 })
      const note = await page.locator('.override-note').count()
      const errs = await page.locator('.state-box.error').count()
      record('R1-02e', '복구 버튼 → 정상 결과 + 덮어쓰기 해제', '결과 표시, override-note 0, 오류 0', `override-note ${note}, 오류 ${errs}`, note === 0 && errs === 0)
    }
    await page.close()
  })

  // ── R1-05 / R1-06: 편도 30분 ───────────────────────────────
  await section('R1-05-06', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
    await page.goto(BASE)
    await page.getByRole('button', { name: /^L03/ }).first().waitFor()
    await page.getByLabel('편도 최대 시간').fill('30')
    await page.getByRole('button', { name: '이 조건으로 비교하기' }).click()
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: /^L03/ }).first().click()
    await page.locator('#detail-title').waitFor()
    const chip = (await page.locator('.detail-head .chip, .detail-head [class*="status"]').first().innerText().catch(() => '')).trim()
    const form = await page.locator('form.override').count()
    record('R1-05', '편도 30분 L03(fail) 상세에 관리비 입력 폼', '폼 1개', `폼 ${form}개 (상태칩="${chip}")`, form === 1)
    const warn = (await page.locator('.living-warn').first().innerText().catch(() => '')).trim()
    const bad = warn.includes('판단 불가')
    record('R1-06', '경고 문구가 판정을 "판단 불가"로 단정하지 않음', '경고 있음 + "판단 불가" 미포함', `"${warn}"`, warn.length > 0 && !bad)
    // 입력해도 다른 실패 사유 유지
    if (form === 1) {
      await page.getByPlaceholder('예: 60000').fill('60000')
      await page.getByRole('button', { name: '이 관리비로 다시 계산' }).click()
      await page.getByText(/직접 입력한 관리비 1건 반영 중/).waitFor({ timeout: 5000 })
      const reasons = (await page.locator('ul.reasons').innerText()).replace(/\s+/g, ' ')
      record('R1-05b', '관리비 입력 후에도 시간 초과 사유 유지', '사유에 "분" 시간 초과 포함', reasons, /분|시간/.test(reasons))
    }
    await page.screenshot({ path: join(OUT, 'r1-05-06-detail.png'), fullPage: true })
    await page.close()
  })

  // ── R1-07: 지도 마커 포커스 링 ─────────────────────────────
  await section('R1-07', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
    await page.goto(BASE)
    await page.locator('.mk').first().waitFor()
    await page.locator('.mk').first().scrollIntoViewIfNeeded()
    // 모양별(원·사각형·다각형) 첫 마커에 Tab 으로 도달해 포커스 링 가시성을 본다.
    const shapes = { circle: '.mk-pass', rect: '.mk-fail', polygon: '.mk-unknown, .mk-route_failed' }
    for (const [shape, sel] of Object.entries(shapes)) {
      const target = page.locator(sel).first()
      if ((await target.count()) === 0) continue
      const idx = await page.evaluate((s) => {
        const all = [...document.querySelectorAll('.mk')]
        return all.indexOf(document.querySelector(s))
      }, sel)
      await page.locator('.mk').first().focus()
      for (let i = 0; i < idx; i++) await page.keyboard.press('Tab')
      const info = await page.evaluate(() => {
        const g = document.activeElement
        const ring = g.querySelector('.focus-ring')
        const own = getComputedStyle(g)
        const shapeEl = g.querySelector('rect, polygon, circle:not(.halo):not(.focus-ring)')
        const ringShown = ring ? getComputedStyle(ring).display !== 'none' && parseFloat(getComputedStyle(ring).strokeWidth) >= 2 : false
        return {
          focusVisible: g.matches(':focus-visible'),
          outline: own.outlineStyle,
          ringShown,
          shapeStroke: shapeEl ? getComputedStyle(shapeEl).stroke : '',
          label: g.getAttribute('aria-label'),
        }
      })
      const visible = info.focusVisible && (info.ringShown || info.outline !== 'none')
      record(`R1-07-${shape}`, `${shape} 마커 Tab 포커스 링`, 'focus-visible 이고 링 표시', JSON.stringify(info), visible)
      await page.screenshot({ path: join(OUT, `r1-07-focus-${shape}.png`), clip: await page.locator('figure.map').boundingBox() })
    }
    await page.close()
  })
} finally {
  await browser.close()
}

writeFileSync(join(OUT, 'check-f2-ui.json'), JSON.stringify(results, null, 2))
const failed = results.filter((r) => !r.passed)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
