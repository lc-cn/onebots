<template>
  <el-drawer
    v-model="visible"
    title="登录验证"
    direction="btt"
    size="45%"
    :show-close="true"
  >
    <div class="verification-list">
      <template v-for="(req, index) in pending" :key="`${req.platform}-${req.account_id}-${req.type}-${index}`">
        <el-card class="verification-card" shadow="hover">
          <template #header>
            <div class="card-header">
              <span class="label">{{ req.platform }} / {{ req.account_id }}</span>
              <el-button type="danger" link size="small" @click="onReject(req)">关闭</el-button>
            </div>
          </template>

          <div class="verification-body">
            <p class="hint">{{ req.hint ?? '需要完成验证' }}</p>
            <template v-if="req.options?.blocks?.length">
              <template v-for="(block, i) in req.options.blocks" :key="i">
                <img
                  v-if="block.type === 'image'"
                  :src="`data:image/png;base64,${block.base64}`"
                  :alt="block.alt ?? ''"
                  class="block-img"
                />
                <el-link
                  v-else-if="block.type === 'link'"
                  :href="block.url"
                  type="primary"
                  target="_blank"
                  class="block-link"
                >
                  {{ block.label ?? block.url }}
                </el-link>
                <p v-else-if="block.type === 'text'" class="block-text">{{ block.content }}</p>
                <el-input
                  v-else-if="block.type === 'input'"
                  v-model="inputValues[inputKey(req, block.key)]"
                  :placeholder="block.placeholder"
                  :maxlength="block.maxLength"
                  :show-password="block.secret"
                  class="block-input"
                  clearable
                />
              </template>
            </template>
            <div class="actions">
              <template v-if="req.requestSmsAvailable && requestSms">
                <el-button
                  type="default"
                  :loading="requestSmsLoading[reqKey(req)]"
                  @click="handleRequestSms(req)"
                >
                  发送验证码
                </el-button>
              </template>
              <template v-if="hasInputBlocks(req)">
                <el-button
                  type="primary"
                  :loading="submitting[reqKey(req)]"
                  @click="handleApprove(req)"
                >
                  提交
                </el-button>
              </template>
              <el-button type="danger" link @click="onReject(req)">关闭</el-button>
            </div>
          </div>
        </el-card>
      </template>
      <el-empty v-if="pending.length === 0" description="暂无待处理验证" />
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { VerificationRequest, VerificationBlock } from '../types'

const props = defineProps<{
  pending: VerificationRequest[]
  /** 用户确认/提交时调用，data 为 options 中 input 块按 key 收集的值；返回 success 供面板提示 */
  onApprove: (req: VerificationRequest, data: Record<string, string>) => Promise<{ success: boolean; message?: string }>
  /** 用户关闭/拒绝时调用 */
  onReject: (req: VerificationRequest) => void
  /** 请求发送短信验证码（当 request.requestSmsAvailable 时展示「发送验证码」按钮） */
  requestSms?: (platform: string, account_id: string) => Promise<{ success: boolean; message?: string }>
  shouldOpenDrawer?: boolean
  resetOpenDrawer?: () => void
}>()

const visible = ref(false)
const inputValues = ref<Record<string, string>>({})
const submitting = ref<Record<string, boolean>>({})
const requestSmsLoading = ref<Record<string, boolean>>({})

watch(() => props.shouldOpenDrawer, (v) => {
  if (v) {
    visible.value = true
    props.resetOpenDrawer?.()
  }
})

watch(() => props.pending.length, (n) => {
  if (n === 0) visible.value = false
}, { immediate: true })

const reqKey = (req: VerificationRequest) => `${req.platform}:${req.account_id}:${req.type}`
const inputKey = (req: VerificationRequest, key: string) => `${reqKey(req)}:${key}`

function hasInputBlocks(req: VerificationRequest): boolean {
  return req.options?.blocks?.some((b): b is VerificationBlock & { type: 'input' } => b.type === 'input') ?? false
}

function collectInputData(req: VerificationRequest): Record<string, string> {
  const data: Record<string, string> = {}
  req.options?.blocks?.forEach((block) => {
    if (block.type === 'input') {
      const v = inputValues.value[inputKey(req, block.key)]?.trim()
      if (v !== undefined) data[block.key] = v
    }
  })
  return data
}

async function handleRequestSms(req: VerificationRequest) {
  if (!props.requestSms) return
  const key = reqKey(req)
  requestSmsLoading.value[key] = true
  try {
    const result = await props.requestSms(req.platform, req.account_id)
    if (result?.success) ElMessage.success('验证码已发送，请查收短信')
    else ElMessage.error(result?.message ?? '发送失败')
  } catch (e) {
    ElMessage.error((e as Error)?.message ?? '发送失败')
  } finally {
    requestSmsLoading.value[key] = false
  }
}

async function handleApprove(req: VerificationRequest) {
  const data = collectInputData(req)
  const keys = req.options?.blocks?.filter((b) => b.type === 'input').map((b) => (b as { key: string }).key) ?? []
  if (keys.length > 0 && keys.every((k) => data[k])) {
    submitting.value[reqKey(req)] = true
    try {
      const result = await props.onApprove(req, data)
      if (result?.success) ElMessage.success('已提交，请等待结果')
      else ElMessage.error(result?.message ?? '提交失败')
    } catch (e) {
      ElMessage.error((e as Error)?.message ?? '提交失败')
    } finally {
      submitting.value[reqKey(req)] = false
    }
  } else {
    ElMessage.warning('请填写完整后再提交')
  }
}
</script>

<style lang="scss" scoped>
.verification-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 0 8px;
}

.verification-card {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    .label {
      font-weight: 500;
      color: var(--text-primary);
    }
  }

  .verification-body {
    .hint {
      margin: 0 0 12px;
      color: var(--text-secondary);
      font-size: 13px;
    }
    .block-img {
      display: block;
      max-width: 220px;
      height: auto;
      margin: 8px 0;
    }
    .block-link {
      display: block;
      margin-bottom: 8px;
      word-break: break-all;
    }
    .block-text {
      margin: 8px 0 0;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .block-input {
      max-width: 320px;
      margin: 12px 0 8px;
      display: block;
    }
    .actions {
      margin-top: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
  }
}
</style>
