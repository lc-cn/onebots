const DEFAULT_PORT = 6727

export const isDev = import.meta.env.DEV

const getEnvPort = () => {
  const value = import.meta.env.VITE_API_PORT
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export const getServerPort = () => {
  const stored = localStorage.getItem('onebots:serverPort')
  const storedPort = stored ? Number(stored) : undefined
  if (storedPort && Number.isFinite(storedPort)) return storedPort

  const envPort = getEnvPort()
  if (envPort) return envPort

  return DEFAULT_PORT
}

const getProtocol = () => window.location.protocol

/** 生产环境且未配置单独 API 地址时，使用同源（与页面同 host:port），避免 HF/Docker 等部署时仍请求 6727 */
export const getApiBaseUrl = () => {
  if (isDev) return ''

  const envBase = import.meta.env.VITE_API_BASE
  if (envBase) return envBase

  return ''
}

/** 生产环境且未配置单独 WS 地址时，使用当前页面的 origin（HF/Docker 等与页面同端口） */
export const getWsBaseUrl = () => {
  const envBase = import.meta.env.VITE_WS_BASE
  if (envBase) return envBase

  if (isDev) {
    const port = getServerPort()
    const wsProtocol = getProtocol() === 'https:' ? 'wss' : 'ws'
    return `${wsProtocol}://${window.location.hostname}:${port}`
  }
  const wsProtocol = getProtocol() === 'https:' ? 'wss' : 'ws'
  return `${wsProtocol}://${window.location.host}`
}

export const buildApiUrl = (path: string) => {
  const base = getApiBaseUrl()
  if (!base) return path
  return `${base}${path}`
}

export const buildWsUrl = (path: string) => {
  const base = getWsBaseUrl()
  return `${base}${path}`
}
