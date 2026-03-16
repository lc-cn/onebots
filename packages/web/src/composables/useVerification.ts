import { ref, onMounted, onUnmounted } from 'vue'
import type { VerificationRequest } from '../types'
import { buildApiUrl } from '../config'
import { authFetch, appendAuthQuery } from './useAuth'

/** 合并单条验证到列表（同 platform+account_id+type 只保留最新） */
function mergePending(list: VerificationRequest[], item: VerificationRequest): VerificationRequest[] {
  return [
    ...list.filter(
      (r) => !(r.platform === item.platform && r.account_id === item.account_id && r.type === item.type)
    ),
    item,
  ]
}

export function useVerification() {
  const pending = ref<VerificationRequest[]>([])
  /** 仅在有新验证通过 SSE 到达时置为 true，用于自动打开抽屉；首屏拉取的待处理列表不自动弹窗 */
  const shouldOpenDrawer = ref(false)
  let verificationEventSource: EventSource | null = null

  /** 从服务端拉取待处理验证（Web 未在线时产生的验证，打开页面后可补拉） */
  const fetchPending = async () => {
    try {
      const response = await authFetch(buildApiUrl('/api/verification/pending'))
      if (response.ok) {
        const list = (await response.json()) as VerificationRequest[]
        if (Array.isArray(list)) {
          let next = pending.value
          for (const item of list) {
            if (item.platform && item.account_id && item.type) next = mergePending(next, item)
          }
          pending.value = next
        }
      }
    } catch (err) {
      console.error('拉取待处理验证失败:', err)
    }
  }

  const connect = () => {
    const url = appendAuthQuery(buildApiUrl('/api/verification/stream'))
    verificationEventSource = new EventSource(url)

    verificationEventSource.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data) as VerificationRequest
        if (payload.platform && payload.account_id && payload.type) {
          const prevLen = pending.value.length
          pending.value = mergePending(pending.value, payload)
          if (pending.value.length > prevLen) shouldOpenDrawer.value = true
        }
      } catch (err) {
        console.error('解析验证事件失败:', err)
      }
    }

    verificationEventSource.onerror = () => {
      verificationEventSource?.close()
      verificationEventSource = null
      setTimeout(connect, 5000)
    }
  }

  const dismiss = (req: VerificationRequest) => {
    pending.value = pending.value.filter(
      (r) => !(r.platform === req.platform && r.account_id === req.account_id && r.type === req.type)
    )
  }

  /** 请求向密保手机发送短信验证码（仅当 request.requestSmsAvailable 时展示按钮并调用） */
  const requestSms = async (
    platform: string,
    account_id: string
  ): Promise<{ success: boolean; message?: string }> => {
    try {
      const response = await authFetch(buildApiUrl('/api/verification/request-sms'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, account_id }),
      })
      const result = await response.json().catch(() => ({}))
      if (response.ok && result.success) return { success: true }
      return { success: false, message: result.message || '请求失败' }
    } catch (err) {
      console.error('请求短信验证码失败:', err)
      return { success: false, message: (err as Error).message }
    }
  }

  const submit = async (
    platform: string,
    account_id: string,
    type: string,
    data: Record<string, unknown>
  ): Promise<{ success: boolean; message?: string }> => {
    try {
      const response = await authFetch(buildApiUrl('/api/verification/submit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, account_id, type, data }),
      })
      const result = await response.json().catch(() => ({}))
      if (response.ok && result.success) {
        dismiss({ platform, account_id, type, data } as VerificationRequest)
        return { success: true }
      }
      return { success: false, message: result.message || '提交失败' }
    } catch (err) {
      console.error('提交验证失败:', err)
      return { success: false, message: (err as Error).message }
    }
  }

  const cleanup = () => {
    verificationEventSource?.close()
    verificationEventSource = null
  }

  onMounted(() => {
    fetchPending()
    connect()
  })

  onUnmounted(() => {
    cleanup()
  })

  const requestOpenDrawer = () => {
    shouldOpenDrawer.value = true
  }

  const resetOpenDrawer = () => {
    shouldOpenDrawer.value = false
  }

  return {
    pending,
    shouldOpenDrawer,
    fetchPending,
    connect,
    dismiss,
    submit,
    requestSms,
    requestOpenDrawer,
    resetOpenDrawer,
    cleanup,
  }
}
