<template>
  <el-container class="onebots-container">
    <!-- 顶部导航栏 -->
    <el-header class="header">
      <div class="header-content">
        <div class="logo">
          <el-icon :size="28"><Monitor /></el-icon>
          <span class="title">OneBots 管理平台</span>
        </div>
        <div class="header-actions">
          <el-badge :value="onlineBotCount" :hidden="onlineBotCount === 0" type="success">
            <el-button :icon="Connection" circle />
          </el-badge>
          <el-switch
            v-model="isDark"
            inline-prompt
            :active-icon="Moon"
            :inactive-icon="Sunny"
            @change="toggleTheme"
          />
        </div>
      </div>
    </el-header>

    <el-container class="main-container">
      <!-- 侧边栏 -->
      <el-aside :width="isCollapse ? '64px' : '200px'" class="sidebar">
        <el-menu
          :default-active="currentRoute"
          :collapse="isCollapse"
          router
        >
          <el-menu-item index="/bots">
            <el-icon><Monitor /></el-icon>
            <template #title>机器人管理</template>
          </el-menu-item>
          <el-menu-item index="/config">
            <el-icon><Setting /></el-icon>
            <template #title>配置管理</template>
          </el-menu-item>
          <el-menu-item index="/system">
            <el-icon><DataAnalysis /></el-icon>
            <template #title>系统信息</template>
          </el-menu-item>
          <el-menu-item index="/terminal">
            <el-icon><Monitor /></el-icon>
            <template #title>Web 控制台</template>
          </el-menu-item>
          <el-menu-item index="/logs">
            <el-icon><Document /></el-icon>
            <template #title>系统日志</template>
          </el-menu-item>
        </el-menu>
        <div class="collapse-btn">
          <el-button
            :icon="isCollapse ? Expand : Fold"
            circle
            @click="isCollapse = !isCollapse"
          />
        </div>
      </el-aside>

      <!-- 主内容区 -->
      <el-main class="content">
        <router-view v-slot="{ Component }">
          <transition name="fade-slide" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { Monitor, Setting, DataAnalysis, Document, Connection, Moon, Sunny, Expand, Fold } from '@element-plus/icons-vue'
import { useTheme } from '../composables/useTheme'
import { useApi } from '../composables/useApi'

const route = useRoute()
const currentRoute = computed(() => route.path)

const { isDark, toggleTheme } = useTheme()
const { onlineBotCount } = useApi()
const isCollapse = ref(false)
</script>

<style lang="scss" scoped>
.onebots-container {
  height: 100vh;
  background: var(--bg-color);
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  padding: 0 24px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border-color);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);

  .header-content {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);

    .el-icon {
      color: var(--text-primary);
    }
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 16px;
  }
}

.main-container {
  height: calc(100vh - 60px);
  overflow: hidden;
}

.sidebar {
  background: var(--card-bg);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  transition: width 0.2s ease;

  :deep(.el-menu) {
    flex: 1;
    background: transparent;
    border: none;
    overflow-y: auto;
    overflow-x: hidden;

    .el-menu-item {
      margin: 4px 8px;
      border-radius: 4px;
      transition: all 0.2s ease;
      color: var(--text-secondary);
      border: 1px solid transparent;

      &:hover {
        background: var(--hover-bg);
        color: var(--text-primary);
        border-color: var(--border-color);
      }

      &.is-active {
        background: var(--text-primary);
        color: var(--bg-color);
        border-color: var(--text-primary);
        font-weight: 500;
      }
    }
  }

  .collapse-btn {
    padding: 12px;
    text-align: center;
    border-top: 1px solid var(--border-color);

    .el-button {
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-secondary);

      &:hover {
        background: var(--hover-bg);
        border-color: var(--text-primary);
        color: var(--text-primary);
      }
    }
  }
}

.content {
  background: var(--bg-color);
  overflow: hidden;
  padding: 0;
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.2s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateX(10px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}
</style>
