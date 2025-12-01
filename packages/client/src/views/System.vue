<template>
  <el-scrollbar class="page-scrollbar">
    <div class="page-content">
      <div class="page-header">
        <h2>
          <el-icon><DataAnalysis /></el-icon>
          系统信息
        </h2>
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
          <el-descriptions-item label="进程 ID" :span="1">
            {{ systemInfo.process_id }}
          </el-descriptions-item>
          <el-descriptions-item label="父进程 ID" :span="1">
            {{ systemInfo.process_parent_id }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>
    </div>
  </el-scrollbar>
</template>

<script setup lang="ts">
import { DataAnalysis, Clock, Histogram, Cpu } from '@element-plus/icons-vue'
import { useApi } from '../composables/useApi'
import { formatSize, formatTime } from '../utils'

const { systemInfo } = useApi()
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
</style>
