import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import test from 'node:test'
import { checkPort } from './dev.mjs'

test('occupied ports fail without interrupting the existing listener', async () => {
  const listener = createServer()
  await new Promise((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', resolve)
  })
  try {
    await assert.rejects(checkPort(listener.address().port), /포트를 사용할 수 없습니다/)
    assert.equal(listener.listening, true)
  } finally {
    await new Promise((resolve) => listener.close(resolve))
  }
})

test('an available port can be checked', async () => {
  await checkPort(0)
})
