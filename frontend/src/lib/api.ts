export type HealthResponse = {
  status: 'ok'
  service: 'real-rent-api'
}

const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

export async function requestApi<T>(
  path: string,
  validate: (data: unknown) => data is T,
  init: RequestInit = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, { ...init, signal: AbortSignal.timeout(8000) })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('서버 응답이 8초를 넘었습니다. 다시 시도해 주세요.')
    }
    throw new Error('서버에 연결할 수 없습니다. 실행 상태와 연결 설정을 확인해 주세요.')
  }

  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = typeof data === 'object' && data !== null && 'detail' in data ? data.detail : null
    throw new Error(typeof detail === 'string'
      ? detail : `서버가 오류를 반환했습니다. (HTTP ${response.status}) 입력값을 확인해 주세요.`)
  }
  if (!validate(data)) {
    throw new Error('서버 응답이 연결 규약과 다릅니다.')
  }
  return data
}

export function getHealth(): Promise<HealthResponse> {
  return requestApi('/health', (data): data is HealthResponse => (
    typeof data === 'object' && data !== null &&
    'status' in data && data.status === 'ok' &&
    'service' in data && data.service === 'real-rent-api'
  ))
}
