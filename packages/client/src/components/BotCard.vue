<template>
  <el-card class="bot-card" shadow="hover">
    <template #header>
      <div class="bot-header">
        <el-avatar :size="40" :src="bot.avatar">
          {{ bot.nickname }}
        </el-avatar>
        <div class="bot-info">
          <div class="bot-name">{{ bot.nickname }}</div>
          <div class="bot-id">{{ bot.uin }}</div>
        </div>
      </div>
    </template>

    <div class="bot-details">
      <el-descriptions :column="1" size="small">
        <el-descriptions-item label="状态">
          <el-tag
            :type="
              bot.status === 'online'
                ? 'success'
                : bot.status === 'pending'
                ? 'warning'
                : 'danger'
            "
            effect="dark"
          >
            {{
              bot.status === 'online'
                ? '在线'
                : bot.status === 'pending'
                ? '连接中'
                : '离线'
            }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="平台">
          <div class="platform-info">
            <el-avatar :size="20" :src="adapterIcon" />
            <span>{{ bot.platform }}</span>
          </div>
        </el-descriptions-item>
        <el-descriptions-item v-if="bot.dependency" label="依赖">
          {{ bot.dependency }}
        </el-descriptions-item>
      </el-descriptions>

      <div v-if="bot.urls && bot.urls.length" class="bot-urls">
        <el-divider content-position="left">接入点</el-divider>
        <el-space wrap>
          <el-link
            v-for="url in bot.urls"
            :key="url"
            :href="getFullUrl(url)"
            type="primary"
            :icon="Link"
            target="_blank"
          >
            {{ url }}
          </el-link>
        </el-space>
      </div>
    </div>

    <template #footer>
      <div class="bot-actions">
        <el-button
          v-if="bot.status === 'offline'"
          type="success"
          :icon="VideoPlay"
          @click="emit('start', bot)"
        >
          上线
        </el-button>
        <el-button
          v-else-if="bot.status === 'online'"
          type="danger"
          :icon="VideoPause"
          @click="emit('stop', bot)"
        >
          下线
        </el-button>
        <el-button
          v-else
          type="warning"
          :icon="Loading"
          loading
          disabled
        >
          连接中
        </el-button>
      </div>
    </template>
  </el-card>
</template>

<script setup lang="ts">
import { VideoPlay, VideoPause, Loading, Link } from '@element-plus/icons-vue'
import type { AccountInfo } from '../types'

interface Props {
  bot: AccountInfo
  adapterIcon: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  start: [bot: AccountInfo]
  stop: [bot: AccountInfo]
}>()

const getFullUrl = (url: string) => {
  const port = localStorage.getItem('OneBots:serverPort')
  return `${location.protocol}//${location.hostname}:${port}${url}`
}
</script>

<style lang="scss" scoped>
.bot-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  transition: all 0.2s ease;

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    border-color: var(--text-secondary);
  }

  :deep(.el-card__header) {
    background: var(--card-bg);
    border-bottom: 1px solid var(--border-color);
    padding: 16px;
  }

  :deep(.el-card__body) {
    padding: 16px;
  }

  :deep(.el-card__footer) {
    background: var(--card-bg);
    border-top: 1px solid var(--border-color);
    padding: 12px 16px;
  }

  .bot-header {
    display: flex;
    align-items: center;
    gap: 12px;

    .bot-info {
      flex: 1;
      min-width: 0;

      .bot-name {
        font-size: 15px;
        font-weight: 500;
        color: var(--text-primary);
        margin-bottom: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .bot-id {
        font-size: 12px;
        color: var(--text-secondary);
        font-family: 'Courier New', monospace;
      }
    }
  }

  .bot-details {
    .platform-info {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .bot-urls {
      margin-top: 12px;

      .el-divider {
        margin: 12px 0;
      }
    }
  }

  .bot-actions {
    display: flex;
    justify-content: flex-end;

    .el-button {
      flex: 1;
      max-width: 120px;
    }
  }
}
</style>
