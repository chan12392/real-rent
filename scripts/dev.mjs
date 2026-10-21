import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

export function checkPort(port) {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', () => reject(new Error(`127.0.0.1:${port} 포트를 사용할 수 없습니다. 실행 중인 서비스를 확인해 주세요.`)))
    server.listen(port, '127.0.0.1', () => server.close(resolvePort))
  })
}

async function main() {
  const windows = process.platform === 'win32'
  const python = join(root, 'backend', '.venv', windows ? 'Scripts/python.exe' : 'bin/python')
  const vite = join(root, 'frontend/node_modules/vite/bin/vite.js')
  if (!existsSync(python) || !existsSync(vite)) {
    throw new Error('저장소 루트에서 npm run setup을 먼저 실행해 주세요.')
  }
  await Promise.all([checkPort(8000), checkPort(5173)])
  const children = []
  let stopping = false

  async function stop(code = 0) {
    if (stopping) return
    stopping = true
    await Promise.all(children.map((child) => new Promise((done) => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return done()
      if (windows) {
        const cleanup = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        })
        let output = ''
        cleanup.stdout.on('data', (chunk) => { output += chunk })
        cleanup.stderr.on('data', (chunk) => { output += chunk })
        cleanup.once('error', (error) => { console.error(error.message); done() })
        cleanup.once('exit', (exitCode) => {
          if (exitCode && child.exitCode === null) console.error(output.trim())
          done()
        })
      } else {
        child.once('exit', done)
        try { process.kill(-child.pid, 'SIGTERM') } catch { done() }
      }
    })))
    process.exit(code)
  }

  function start(command, args, cwd, name) {
    const child = spawn(command, args, {
      cwd, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, detached: !windows,
    })
    children.push(child)
    console.log(`${name} PID: ${child.pid}`)
    child.once('error', (error) => { console.error(`${name}: ${error.message}`); void stop(1) })
    child.once('exit', (code) => {
      if (!stopping) {
        console.error(`${name} 종료 (code=${code}). 함께 실행한 서비스를 정리합니다.`)
        void stop(code || 1)
      }
    })
  }

  process.on('SIGINT', () => { void stop() })
  process.on('SIGTERM', () => { void stop() })
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (value) => { if (value.trim() === 'q') void stop() })
  const backendArgs = ['-m', 'uvicorn', 'app.main:app', '--reload', '--reload-dir', 'app', '--host', '127.0.0.1', '--port', '8000']
  if (existsSync(join(root, 'backend/.env'))) backendArgs.push('--env-file', '.env')
  start(python, backendArgs, join(root, 'backend'), 'API')
  start(process.execPath, [vite], join(root, 'frontend'), '화면')
  console.log('화면 http://127.0.0.1:5173 | API 문서 http://127.0.0.1:8000/docs')
  console.log('준비 로그를 확인한 뒤 접속하세요. 종료: Ctrl+C 또는 q + Enter')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
