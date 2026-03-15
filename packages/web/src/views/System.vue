<template>
  <el-scrollbar class="page-scrollbar">
    <div class="page-content">
      <div class="page-header">
        <h2>
          <el-icon><DataAnalysis /></el-icon>
          系统信息
        </h2>
        <el-button type="primary" :icon="Upload" :loading="backupLoading" @click="handleBackup">
          备份到仓库
        </el-button>
        <el-button type="warning" :icon="RefreshRight" :loading="restartLoading" @click="handleRestart">
          重启服务
        </el-button>
      </div>
      
      <el-row v-if="systemInfo" :gutter="16">
        <el-col :xs="24" :sm="12" :lg="8">
          <el-card shadow="hover" class="stat-card">
            <template #header>
              <div class="stat-header">
                <el-icon :size="24" color="var(--el-color-primary)">
                  <Clock />
                </el-icon>
                <span>运行时长</span>
              </div>
            </template>
            <div class="stat-value">{{ formatTime(systemInfo.uptime) }}</div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :lg="8">
          <el-card shadow="hover" class="stat-card">
            <template #header>
              <div class="stat-header">
                <el-icon :size="24" color="var(--el-color-success)">
                  <Histogram />
                </el-icon>
                <span>进程内存</span>
              </div>
            </template>
            <div class="stat-value">
              {{ formatSize(systemInfo.process_use_memory) }}
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :lg="8">
          <el-card shadow="hover" class="stat-card">
            <template #header>
              <div class="stat-header">
                <el-icon :size="24" color="var(--el-color-warning)">
                  <Cpu />
                </el-icon>
                <span>系统内存</span>
              </div>
            </template>
            <div class="stat-value">
              {{ formatSize(systemInfo.free_memory) }} /
              {{ formatSize(systemInfo.total_memory) }}
            </div>
            <div class="stat-desc">
              使用率:
              {{
                (
                  ((systemInfo.total_memory - systemInfo.free_memory) /
                    systemInfo.total_memory) *
                  100
                ).toFixed(1)
              }}%
            </div>
          </el-card>
        </el-col>
      </el-row>

      <el-card v-if="systemInfo" shadow="never" class="system-details">
        <el-descriptions title="详细信息" :column="2" border>
          <el-descriptions-item label="用户名" :span="1">
            {{ systemInfo.username }}
          </el-descriptions-item>
          <el-descriptions-item label="内核" :span="1">
            {{ systemInfo.system_platform }}
          </el-descriptions-item>
          <el-descriptions-item label="架构" :span="1">
            {{ systemInfo.system_arch }}
          </el-descriptions-item>
          <el-descriptions-item label="系统版本" :span="1">
            {{ systemInfo.system_version }}
          </el-descriptions-item>
          <el-descriptions-item label="系统运行时长" :span="1">
            {{ formatTime(systemInfo.system_uptime) }}
          </el-descriptions-item>
          <el-descriptions-item label="Node.js 版本" :span="1">
            {{ systemInfo.node_version }}
          </el-descriptions-item>
          <el-descriptions-item label="SDK 版本" :span="2">
            onebots v{{ systemInfo.sdk_version }}
          </el-descriptions-item>
          <el-descriptions-item label="运行目录" :span="2">
            <el-text truncated>{{ systemInfo.process_cwd }}</el-text>
          </el-descriptions-item>
          <el-descriptions-item v-if="systemInfo.configDir" label="配置目录" :span="2">
            <el-text truncated>{{ systemInfo.configDir }}</el-text>
            <el-tooltip content="Docker 下请挂载此目录以持久化配置与数据" placement="top">
              <el-icon class="tip-icon"><InfoFilled /></el-icon>
            </el-tooltip>
          </el-descriptions-item>
          <el-descriptions-item v-if="systemInfo.configPath" label="配置文件" :span="2">
            <el-text truncated>{{ systemInfo.configPath }}</el-text>
          </el-descriptions-item>
          <el-descriptions-item v-if="systemInfo.dataDir" label="数据目录" :span="2">
            <el-text truncated>{{ systemInfo.dataDir }}</el-text>
          </el-descriptions-item>
          <el-descriptions-item label="进程 ID" :span="1">
            {{ systemInfo.process_id }}
          </el-descriptions-item>
          <el-descriptions-item label="父进程 ID" :span="1">
            {{ systemInfo.process_parent_id }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card shadow="never" class="system-details health-card">
        <template #header>
          <span>服务状态</span>
          <el-button link type="primary" size="small" :loading="healthLoading" @click="checkHealth">刷新</el-button>
        </template>
        <el-row :gutter="16">
          <el-col :span="12">
            <div class="health-item">
              <el-icon :size="20" :color="healthStatus.ok ? 'var(--el-color-success)' : 'var(--el-color-danger)'">
                <CircleCheckFilled v-if="healthStatus.ok" />
                <CircleCloseFilled v-else />
              </el-icon>
              <span class="label">/health（存活）</span>
              <el-tag :type="healthStatus.ok ? 'success' : 'danger'" size="small">
                {{ healthStatus.ok ? '正常' : (healthStatus.error || '异常') }}
              </el-tag>
            </div>
          </el-col>
          <el-col :span="12">
            <div class="health-item">
              <el-icon :size="20" :color="readyStatus.ok ? 'var(--el-color-success)' : 'var(--el-color-danger)'">
                <CircleCheckFilled v-if="readyStatus.ok" />
                <CircleCloseFilled v-else />
              </el-icon>
              <span class="label">/ready（就绪）</span>
              <el-tag :type="readyStatus.ok ? 'success' : 'danger'" size="small">
                {{ readyStatus.ok ? '正常' : (readyStatus.error || '异常') }}
              </el-tag>
            </div>
          </el-col>
        </el-row>
      </el-card>
    </div>
  </el-scrollbar>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { DataAnalysis, Clock, Histogram, Cpu, InfoFilled, CircleCheckFilled, CircleCloseFilled, RefreshRight, Upload } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useApi } from '../composables/useApi'
import { authFetch } from '../composables/useAuth'
import { formatSize, formatTime } from '../utils'
import { buildApiUrl } from '../config'

const { systemInfo } = useApi()

const healthStatus = ref<{ ok: boolean; error?: string }>({ ok: false })
const readyStatus = ref<{ ok: boolean; error?: string }>({ ok: false })
const healthLoading = ref(false)
const restartLoading = ref(false)
const backupLoading = ref(false)

async function handleBackup() {
  backupLoading.value = true
  try {
    const res = await authFetch(buildApiUrl('/api/system/backup-to-hf'), { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data?.success) {
      ElMessage.success(data?.message ?? '已备份到仓库')
    } else {
      ElMessage.error(data?.message ?? '备份失败')
    }
  } catch (e) {
    ElMessage.error((e as Error).message ?? '请求失败')
  } finally {
    backupLoading.value = false
  }
}

async function checkHealth() {
  healthLoading.value = true
  healthStatus.value = { ok: false }
  readyStatus.value = { ok: false }
  try {
    const healthRes = await fetch(buildApiUrl('/health') || '/health')
    healthStatus.value = healthRes.ok ? { ok: true } : { ok: false, error: `HTTP ${healthRes.status}` }
    const readyRes = await fetch(buildApiUrl('/ready') || '/ready')
    readyStatus.value = readyRes.ok ? { ok: true } : { ok: false, error: `HTTP ${readyRes.status}` }
  } catch (e) {
    healthStatus.value = { ok: false, error: (e as Error).message }
    readyStatus.value = { ok: false, error: (e as Error).message }
  } finally {
    healthLoading.value = false
  }
}

async function handleRestart() {
  try {
    await ElMessageBox.confirm(
      '重启后当前进程将退出。若在 Docker 中运行且已设置 restart 策略，容器将自动重新拉起；否则需手动重新启动服务。确认重启？',
      '重启服务',
      {
        confirmButtonText: '确认重启',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
  } catch {
    return
  }
  restartLoading.value = true
  try {
    const res = await authFetch(buildApiUrl('/api/system/restart'), { method: 'POST' })
    if (res.ok) {
      ElMessage.success('服务即将重启，请稍后刷新页面（Docker 下约 10 秒内可恢复）')
    } else {
      const data = await res.json().catch(() => ({}))
      ElMessage.error(data?.message || '重启请求失败')
    }
  } catch (e) {
    ElMessage.error((e as Error).message || '请求失败')
  } finally {
    restartLoading.value = false
  }
}

onMounted(() => {
  checkHealth()
})
</script>

<style lang="scss" scoped>
.page-scrollbar {
  height: 100%;

  :deep(.el-scrollbar__wrap) {
    overflow-x: hidden;
  }
}

.page-content {
  padding: 24px;
  min-height: 100%;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);

  h2 {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);

    .el-icon {
      color: var(--text-primary);
    }
  }
}

.el-row {
  margin-bottom: 20px;
}

.stat-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  transition: all 0.2s ease;
  height: 100%;

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    border-color: var(--text-secondary);
  }

  :deep(.el-card__header) {
    background: var(--card-bg);
    border-bottom: 1px solid var(--border-color);
    padding: 14px 16px;
  }

  .stat-header {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .stat-value {
    font-size: 24px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 6px;
  }

  .stat-desc {
    font-size: 12px;
    color: var(--text-secondary);
  }
}

.system-details {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 4px;

  :deep(.el-descriptions__title) {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 16px;
  }

  :deep(.el-descriptions__body) {
    background: transparent;

    .el-descriptions__table {
      border-color: var(--border-color);
    }

    .el-descriptions__cell {
      background: var(--card-bg);
      border-color: var(--border-color);
    }

    .el-descriptions__label {
      color: var(--text-secondary);
      font-weight: 500;
      font-size: 13px;
    }

    .el-descriptions__content {
      color: var(--text-primary);
      font-size: 13px;
    }
  }
}

.tip-icon {
  margin-left: 6px;
  color: var(--el-color-info);
  cursor: help;
}

.health-card {
  margin-top: 20px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 4px;

  :deep(.el-card__header) {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .health-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;

    .label {
      flex: 1;
      font-size: 13px;
      color: var(--text-secondary);
    }
  }
}
</style>
