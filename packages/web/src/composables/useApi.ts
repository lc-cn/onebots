import { ref, onMounted, onUnmounted, computed } from 'vue'
import type { AdapterInfo, SystemInfo } from '../types'
import { buildApiUrl } from '../config'
import { authFetch, appendAuthQuery } from './useAuth'

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
      const response = await authFetch(buildApiUrl('/api/adapters'))
      if (response.ok) {
        adapters.value = await response.json()
      }
    } catch (error) {
      console.error('获取适配器列表失败:', error)
    }
  }

  const fetchSystemInfo = async () => {
    try {
      const response = await authFetch(buildApiUrl('/api/system'))
      if (response.ok) {
        systemInfo.value = await response.json()
      }
    } catch (error) {
      console.error('获取系统信息失败:', error)
    }
  }

  const startLogsSSE = () => {
    logsEventSource = new EventSource(appendAuthQuery(buildApiUrl('/api/logs')))
    
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

  const startBot = async (platform: string, uin: string): Promise<boolean> => {
    try {
      const response = await authFetch(buildApiUrl('/api/bots/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, uin }),
      })
      if (response.ok) {
        await fetchAdapters()
        return true
      }
      return false
    } catch (error) {
      console.error('启动机器人失败:', error)
      return false
    }
  }

  const stopBot = async (platform: string, uin: string): Promise<boolean> => {
    try {
      const response = await authFetch(buildApiUrl('/api/bots/stop'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, uin }),
      })
      if (response.ok) {
        await fetchAdapters()
        return true
      }
      return false
    } catch (error) {
      console.error('停止机器人失败:', error)
      return false
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
    startBot,
    stopBot,
    startLogsSSE,
    cleanup
  }
}
