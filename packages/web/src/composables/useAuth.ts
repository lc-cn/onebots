import { buildApiUrl } from '../config'
import { managementRequestInit } from '../management-request.js'
import {
  authenticationRequestErrorMessage,
  authenticationRequestInit
} from '../authentication-request.js'

const TOKEN_KEY = 'onebots:authToken'
const REFRESH_KEY = 'onebots:authRefreshToken'
const EXPIRES_KEY = 'onebots:authExpiresAt'
const EXPIRED_FLAG = 'onebots:authExpired'

export type LoginResult =
  | { ok: true; isDefaultCredentials: boolean }
  | { ok: false; message: string; unavailable?: boolean }

export type RefreshResult = { ok: true } | { ok: false; unavailable?: boolean }

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

export const authFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  retry = true
): Promise<Response> => {
  const headers = new Headers(init.headers)
  const authHeaders = buildAuthHeaders()
  Object.entries(authHeaders).forEach(([key, value]) => headers.set(key, value))
  const response = await fetch(input, managementRequestInit({ ...init, headers }))

  if (response.status !== 401) return response

  if (retry) {
    const refreshed = await refresh(init.signal)
    if (refreshed.ok) {
      return authFetch(input, init, false)
    }
    if (refreshed.unavailable) return response
  }

  clearAuth()
  const redirect = encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)
  window.location.assign(`/login?redirect=${redirect}&reason=unauthorized`)
  return response
}

/** 使用鉴权码登录（Bearer Token，与 config 中 access_token 一致） */
export const loginWithToken = async (accessToken: string): Promise<LoginResult> => {
  let response: Response
  try {
    response = await fetch(buildApiUrl('/api/auth/login'), authenticationRequestInit({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: accessToken.trim() })
    }))
  } catch (error) {
    return { ok: false, unavailable: true, message: authenticationRequestErrorMessage(error) }
  }

  if (!response.ok) {
    const fallback = response.status === 401 ? '鉴权码错误' : `登录请求失败（HTTP ${response.status}）`
    const result = await response.json().catch(() => ({ message: fallback }))
    const failure = { ok: false as const, message: result.message || fallback }
    return response.status === 401 ? failure : { ...failure, unavailable: true }
  }

  const result = await response.json().catch(() => null)
  if (result?.token) {
    setToken(result.token, result.expiresAt, result.refreshToken)
    return { ok: true, isDefaultCredentials: !!result.isDefaultCredentials }
  }

  return { ok: false, unavailable: true, message: result?.message || '登录响应格式无效' }
}

export const login = async (username: string, password: string): Promise<LoginResult> => {
  let response: Response
  try {
    response = await fetch(buildApiUrl('/api/auth/login'), authenticationRequestInit({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }))
  } catch (error) {
    return { ok: false, unavailable: true, message: authenticationRequestErrorMessage(error) }
  }

  if (!response.ok) {
    const fallback = response.status === 401 ? '用户名或密码错误' : `登录请求失败（HTTP ${response.status}）`
    const result = await response.json().catch(() => ({ message: fallback }))
    const failure = { ok: false as const, message: result.message || fallback }
    return response.status === 401 ? failure : { ...failure, unavailable: true }
  }

  const result = await response.json().catch(() => null)
  if (result?.token) {
    setToken(result.token, result.expiresAt, result.refreshToken)
    return { ok: true, isDefaultCredentials: !!result.isDefaultCredentials }
  }

  return { ok: false, unavailable: true, message: result?.message || '登录响应格式无效' }
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

export const refresh = async (signal?: AbortSignal | null): Promise<RefreshResult> => {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return { ok: false }

  let response: Response
  try {
    response = await fetch(buildApiUrl('/api/auth/refresh'), authenticationRequestInit({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      signal
    }))
  } catch {
    return { ok: false, unavailable: true }
  }

  if (!response.ok) {
    return response.status === 400 || response.status === 401
      ? { ok: false }
      : { ok: false, unavailable: true }
  }

  const result = await response.json().catch(() => null)
  if (result?.token) {
    setToken(result.token, result.expiresAt, result.refreshToken)
    return { ok: true }
  }

  return { ok: false, unavailable: true }
}
