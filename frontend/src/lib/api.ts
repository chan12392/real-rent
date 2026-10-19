export type HealthResponse = {
  status: 'ok'
  service: 'real-rent-api'
}

const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${apiBase}/health`, {
    signal: AbortSignal.timeout(8000),
  })

  if (!response.ok) {
    throw new Error(`서버가 오류를 반환했습니다. (HTTP ${response.status})`)
  }

  const data: unknown = await response.json()
  if (
    typeof data !== 'object' ||
    data === null ||
    !('status' in data) ||
    data.status !== 'ok' ||
    !('service' in data) ||
    data.service !== 'real-rent-api'
  ) {
    throw new Error('서버 응답이 연결 규약과 다릅니다.')
  }

  return { status: data.status, service: data.service }
}
