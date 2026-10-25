import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { resolve } from 'node:path'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let vite
let server
let requestApi
let origin
const fetch = globalThis.fetch
const healthy = (data) => data?.status === 'ok'

before(async () => {
  vite = await createServer({
    configFile: false,
    root: resolve(import.meta.dirname, '..'),
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  requestApi = (await vite.ssrLoadModule('/src/lib/api.ts')).requestApi
  server = createHttpServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    switch (request.url) {
      case '/api/slow-body':
        response.write('{"status":')
        break
      case '/api/broken-body':
        response.write('{"status":')
        response.flushHeaders()
        setTimeout(() => response.destroy(), 30)
        break
      case '/api/invalid-json':
        response.end('{')
        break
      case '/api/unavailable':
        response.writeHead(503)
        response.end(JSON.stringify({ detail: '시연 데이터를 읽을 수 없습니다.' }))
        break
      default:
        response.end(JSON.stringify({ status: 'ok' }))
    }
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  server?.closeAllConnections()
  await Promise.all([
    server && new Promise((done) => server.close(done)),
    vite?.close(),
  ])
})

function connect(context) {
  context.mock.method(globalThis, 'fetch', (path, init) => fetch(`${origin}${path}`, init))
}

test('valid JSON and HTTP error details survive body handling', async (context) => {
  connect(context)
  assert.deepEqual(await requestApi('/health', healthy), { status: 'ok' })
  await assert.rejects(requestApi('/unavailable', healthy), /시연 데이터를 읽을 수 없습니다/)
  await assert.rejects(requestApi('/invalid-json', healthy), /서버 응답이 연결 규약과 다릅니다/)
})

test('a disconnected response body is a connection error', async (context) => {
  connect(context)
  await assert.rejects(requestApi('/broken-body', healthy), /서버에 연결할 수 없습니다/)
})

test('the eight-second timeout includes the response body', { timeout: 12000 }, async (context) => {
  connect(context)
  await assert.rejects(requestApi('/slow-body', healthy), /서버 응답이 8초를 넘었습니다/)
})
