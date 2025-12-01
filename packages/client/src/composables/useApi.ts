import { ref, onMounted, onUnmounted, computed } from 'vue'
import type { AdapterInfo, SystemInfo } from '../types'

// 开发环境使用代理（相对路径），生产环境使用绝对路径
const isDev = process.env.NODE_ENV === 'development'
const API_BASE = isDev ? '' : 'http://localhost:6727'

export function useApi() {
  const adapters = ref<AdapterInfo[]>([])
  const systemInfo = ref<SystemInfo | null>(null)
  const logs = ref<string[]>([])
  
  let logsEventSource: EventSource | null = null

  const totalBotCount = computed(() => {
    return adapters.value.reduce((acc, adapter) => acc + adapter.accounts.length, 0)
  })

  const onlineBotCount = computed(() => {
    return adapters.value.reduce((acc, adapter) => {
      return acc + adapter.accounts.filter(bot => bot.status === 'online').length
    }, 0)
  })

  const fetchAdapters = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/adapters`)
      if (response.ok) {
        adapters.value = await response.json()
      }
    } catch (error) {
      console.error('获取适配器列表失败:', error)
    }
  }

  const fetchSystemInfo = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/system`)
      if (response.ok) {
        systemInfo.value = await response.json()
      }
    } catch (error) {
      console.error('获取系统信息失败:', error)
    }
  }

  const startLogsSSE = () => {
    logsEventSource = new EventSource(`${API_BASE}/api/logs`)
    
    logsEventSource.onmessage = (e) => {
      const logData = JSON.parse(e.data)
      logs.value.push(logData.message)
      if (logs.value.length > 1000) {
        logs.value = logs.value.slice(-1000)
      }
    }

    logsEventSource.onerror = () => {
      console.error('Logs SSE 连接错误')
      logsEventSource?.close()
      setTimeout(startLogsSSE, 5000)
    }
  }

  const cleanup = () => {
    logsEventSource?.close()
  }

  onMounted(() => {
    fetchAdapters()
    fetchSystemInfo()
  })

  onUnmounted(() => {
    cleanup()
  })

  return {
    adapters,
    systemInfo,
    logs,
    totalBotCount,
    onlineBotCount,
    fetchAdapters,
    fetchSystemInfo,
    startLogsSSE,
    cleanup
  }
}
