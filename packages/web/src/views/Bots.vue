<template>
  <el-scrollbar class="page-scrollbar">
    <div class="page-content">
      <div class="page-header">
        <h2>
          <el-icon><Monitor /></el-icon>
          机器人管理
        </h2>
        <el-tag>共 {{ totalBotCount }} 个机器人</el-tag>
      </div>
      <el-empty v-if="adapters.length === 0" description="暂无机器人" />
      <div v-else class="bot-grid">
        <template v-for="adapter of adapters" :key="adapter.platform">
          <BotCard
            v-for="bot of adapter.accounts"
            :key="`${bot.platform}:${bot.uin}`"
            :bot="bot"
            :adapter-icon="adapter.icon"
            :loading="loadingBots.has(`${bot.platform}:${bot.uin}`)"
            @start="handleBotStart"
            @stop="handleBotStop"
          />
        </template>
      </div>
    </div>
  </el-scrollbar>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Monitor } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useApi } from '../composables/useApi'
import BotCard from '../components/BotCard.vue'
import type { AccountInfo } from '../types'

const { adapters, totalBotCount, startBot, stopBot } = useApi()

const loadingBots = ref<Set<string>>(new Set())

const botKey = (bot: AccountInfo) => `${bot.platform}:${bot.uin}`

const handleBotStart = async (bot: AccountInfo) => {
  const key = botKey(bot)
  loadingBots.value.add(key)
  try {
    const ok = await startBot(bot.platform, bot.uin)
    if (ok) {
      ElMessage.success(`机器人 ${bot.uin} 已上线`)
    } else {
      ElMessage.error(`启动机器人 ${bot.uin} 失败`)
    }
  } finally {
    loadingBots.value.delete(key)
  }
}

const handleBotStop = async (bot: AccountInfo) => {
  const key = botKey(bot)
  loadingBots.value.add(key)
  try {
    const ok = await stopBot(bot.platform, bot.uin)
    if (ok) {
      ElMessage.warning(`机器人 ${bot.uin} 已下线`)
    } else {
      ElMessage.error(`停止机器人 ${bot.uin} 失败`)
    }
  } finally {
    loadingBots.value.delete(key)
  }
}
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
  background: var(--bg-color);
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

.bot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}
</style>
