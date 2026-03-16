<template>
  <el-container class="onebots-container">
    <!-- 顶部导航栏 -->
    <el-header class="header">
      <div class="header-content">
        <div class="logo">
          <el-icon :size="28"><Monitor /></el-icon>
          <span class="title">onebots 管理平台</span>
        </div>
        <div class="header-actions">
          <el-badge :value="onlineBotCount" :hidden="onlineBotCount === 0" type="success">
            <el-button :icon="Connection" circle />
          </el-badge>
          <el-badge :value="verificationPending.length" :hidden="verificationPending.length === 0" type="warning">
            <el-button :icon="Warning" circle @click="verification.requestOpenDrawer()" title="待处理验证" />
          </el-badge>
          <el-switch
            v-model="isDark"
            inline-prompt
            :active-icon="Moon"
            :inactive-icon="Sunny"
            @change="toggleTheme"
          />
          <el-button :icon="SwitchButton" circle @click="handleLogout" />
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
        <el-alert
          v-if="systemInfo?.isDefaultCredentials"
          type="warning"
          :closable="false"
          show-icon
          class="security-banner"
        >
          <template #title>安全提示</template>
          当前使用自动生成的默认账号，存在安全风险，请尽快前往
          <router-link to="/config">配置管理</router-link>
          修改「管理端用户名」与「管理端密码」。
        </el-alert>
        <router-view v-slot="{ Component }">
          <transition name="fade-slide" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>

    <!-- 登录验证（滑块/扫码/设备锁/短信等） -->
    <VerificationPanel
      :pending="verificationPending"
      :on-approve="(req, data) => verification.submit(req.platform, req.account_id, req.type, data)"
      :on-reject="verification.dismiss"
      :request-sms="verification.requestSms"
      :should-open-drawer="verificationShouldOpen"
      :reset-open-drawer="verification.resetOpenDrawer"
    />
  </el-container>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Monitor, Setting, DataAnalysis, Document, Connection, Moon, Sunny, Expand, Fold, SwitchButton, Warning } from '@element-plus/icons-vue'
import { useTheme } from '../composables/useTheme'
import { useApi } from '../composables/useApi'
import { useVerification } from '../composables/useVerification'
import { logout } from '../composables/useAuth'
import VerificationPanel from '../components/VerificationPanel.vue'

const route = useRoute()
const router = useRouter()
const currentRoute = computed(() => route.path)

const { isDark, toggleTheme } = useTheme()
const { onlineBotCount, systemInfo } = useApi()
const verification = useVerification()
const verificationPending = computed(() => verification.pending.value)
const verificationShouldOpen = computed(() => verification.shouldOpenDrawer.value)
const isCollapse = ref(false)

const handleLogout = async () => {
  await logout()
  router.replace('/login')
}
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

.security-banner {
  margin: 12px 16px;
  flex-shrink: 0;
}

.security-banner a {
  color: var(--el-color-warning);
  font-weight: 500;
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
