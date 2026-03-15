import { buildApiUrl } from '../config'

const TOKEN_KEY = 'onebots:authToken'
const REFRESH_KEY = 'onebots:authRefreshToken'
const EXPIRES_KEY = 'onebots:authExpiresAt'
const EXPIRED_FLAG = 'onebots:authExpired'

const getStoredExpiresAt = () => {
  const value = localStorage.getItem(EXPIRES_KEY)
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const clearAuth = () => {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem(EXPIRES_KEY)
  localStorage.removeItem(EXPIRED_FLAG)
}

export const getToken = () => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (!token) return null
  const expiresAt = getStoredExpiresAt()
  if (expiresAt && Date.now() > expiresAt) {
    localStorage.setItem(EXPIRED_FLAG, '1')
    clearAuth()
    return null
  }
  return token
}

export const isAuthenticated = () => !!getToken()

export const setToken = (token: string, expiresAt?: number | null, refreshToken?: string | null) => {
  localStorage.setItem(TOKEN_KEY, token)
  if (expiresAt) {
    localStorage.setItem(EXPIRES_KEY, String(expiresAt))
  } else {
    localStorage.removeItem(EXPIRES_KEY)
  }
  if (refreshToken) {
    localStorage.setItem(REFRESH_KEY, refreshToken)
  }
  localStorage.removeItem(EXPIRED_FLAG)
}

export const buildAuthHeaders = () => {
  const token = getToken()
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

export const getRefreshToken = () => localStorage.getItem(REFRESH_KEY)

export const hasExpiredFlag = () => localStorage.getItem(EXPIRED_FLAG) === '1'

export const clearExpiredFlag = () => localStorage.removeItem(EXPIRED_FLAG)

export const appendAuthQuery = (url: string) => {
  const token = getToken()
  if (!token) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}access_token=${encodeURIComponent(token)}`
}

/** 从当前 URL query 读取 access_token，若存在则写入 localStorage 并返回 true（便于首屏通过 ?access_token= 访问） */
export const consumeTokenFromQuery = (): string | null => {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const token = params.get('access_token')?.trim()
  if (!token) return null
  setToken(token, null, null)
  return token
}

export const authFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  retry = true
): Promise<Response> => {
  const headers = new Headers(init.headers)
  const authHeaders = buildAuthHeaders()
  Object.entries(authHeaders).forEach(([key, value]) => headers.set(key, value))
  const response = await fetch(input, { ...init, headers })

  if (response.status !== 401) return response

  if (retry) {
    const refreshed = await refresh()
    if (refreshed.ok) {
      return authFetch(input, init, false)
    }
  }

  clearAuth()
  const redirect = encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)
  window.location.assign(`/login?redirect=${redirect}&reason=unauthorized`)
  return response
}

/** 使用鉴权码登录（Bearer Token，与 config 中 access_token 一致） */
export const loginWithToken = async (accessToken: string) => {
  const response = await fetch(buildApiUrl('/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: accessToken.trim() })
  })

  if (!response.ok) {
    const message = await response.json().catch(() => ({ message: '鉴权码错误' }))
    return { ok: false, message: message.message || '鉴权码错误' }
  }

  const result = await response.json()
  if (result?.token) {
    setToken(result.token, result.expiresAt, result.refreshToken)
    return { ok: true, isDefaultCredentials: !!result.isDefaultCredentials }
  }

  return { ok: false, message: result?.message || '登录失败' }
}

export const login = async (username: string, password: string) => {
  const response = await fetch(buildApiUrl('/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })

  if (!response.ok) {
    const message = await response.json().catch(() => ({ message: '登录失败' }))
    return { ok: false, message: message.message || '登录失败' }
  }

  const result = await response.json()
  if (result?.token) {
    setToken(result.token, result.expiresAt, result.refreshToken)
    return { ok: true, isDefaultCredentials: !!result.isDefaultCredentials }
  }

  return { ok: false, message: result?.message || '登录失败' }
}

export const logout = async () => {
  const token = getToken()
  if (!token) {
    clearAuth()
    return
  }
  await authFetch(buildApiUrl('/api/auth/logout'), { method: 'POST' }).catch(() => {})
  clearAuth()
}

export const refresh = async () => {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return { ok: false }

  const response = await fetch(buildApiUrl('/api/auth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  })

  if (!response.ok) return { ok: false }

  const result = await response.json().catch(() => null)
  if (result?.token) {
    setToken(result.token, result.expiresAt, result.refreshToken)
    return { ok: true }
  }

  return { ok: false }
}
