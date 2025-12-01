<template>
  <router-view />
</template>

<script setup lang="ts">
</script>

<style lang="scss">
// CSS 变量定义
:root {
  --bg-color: #ffffff;
  --text-primary: #1a1a1a;
  --text-secondary: #666666;
  --border-color: rgba(0, 0, 0, 0.08);
  --card-bg: rgba(0, 0, 0, 0.02);
  --hover-bg: rgba(0, 0, 0, 0.04);
}

.dark {
  --bg-color: #0a0a0a;
  --text-primary: rgba(255, 255, 255, 0.95);
  --text-secondary: rgba(255, 255, 255, 0.5);
  --border-color: rgba(255, 255, 255, 0.08);
  --card-bg: rgba(255, 255, 255, 0.03);
  --hover-bg: rgba(255, 255, 255, 0.06);
}

.light {
  --bg-color: #fafafa;
  --text-primary: #1a1a1a;
  --text-secondary: #666666;
  --border-color: rgba(0, 0, 0, 0.08);
  --card-bg: rgba(0, 0, 0, 0.02);
  --hover-bg: rgba(0, 0, 0, 0.04);
}

// 全局样式
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body,
#app {
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
}

// 滚动条样式
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
  transition: all 0.2s ease;

  &:hover {
    background: var(--text-secondary);
  }
}

// Element Plus 样式覆盖
.el-button {
  border: 1px solid var(--border-color);
  background: var(--card-bg);
  color: var(--text-primary);
  transition: all 0.2s ease;
  backdrop-filter: blur(10px);

  &:hover {
    border-color: rgba(0, 0, 0, 0.15);
    background: var(--hover-bg);
    color: var(--text-primary);
  }

  // 覆盖所有类型按钮的颜色
  &.el-button--primary,
  &.el-button--success,
  &.el-button--warning,
  &.el-button--danger,
  &.el-button--info {
    background: rgba(0, 0, 0, 0.9);
    border-color: rgba(0, 0, 0, 0.9);
    color: rgba(255, 255, 255, 0.95);

    &:hover {
      background: rgba(0, 0, 0, 0.75);
      border-color: rgba(0, 0, 0, 0.75);
      color: rgba(255, 255, 255, 0.95);
    }
  }

  // 深色模式下的主要按钮
  .dark & {
    &.el-button--primary,
    &.el-button--success,
    &.el-button--warning,
    &.el-button--danger,
    &.el-button--info {
      background: rgba(255, 255, 255, 0.9);
      border-color: rgba(255, 255, 255, 0.9);
      color: rgba(0, 0, 0, 0.9);

      &:hover {
        background: rgba(255, 255, 255, 0.75);
        border-color: rgba(255, 255, 255, 0.75);
        color: rgba(0, 0, 0, 0.9);
      }
    }
  }

  // 次要按钮（边框样式）
  &.el-button--primary.is-plain,
  &.el-button--success.is-plain,
  &.el-button--warning.is-plain,
  &.el-button--danger.is-plain,
  &.el-button--info.is-plain {
    background: transparent;
    border-color: var(--border-color);
    color: var(--text-primary);

    &:hover {
      background: var(--hover-bg);
      border-color: rgba(0, 0, 0, 0.2);
      color: var(--text-primary);
    }
  }
}

.el-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  transition: all 0.2s ease;
  backdrop-filter: blur(10px);

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    border-color: rgba(0, 0, 0, 0.12);
  }

  .dark &:hover {
    box-shadow: 0 4px 12px rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.12);
  }
}

.el-tag {
  border: 1px solid var(--border-color);
  background: var(--card-bg);
  color: var(--text-primary);
  backdrop-filter: blur(10px);

  // 覆盖所有类型标签的颜色
  &.el-tag--success,
  &.el-tag--warning,
  &.el-tag--danger,
  &.el-tag--info {
    background: var(--card-bg);
    border-color: var(--border-color);
    color: var(--text-primary);

    &.el-tag--dark {
      background: rgba(0, 0, 0, 0.9);
      border-color: rgba(0, 0, 0, 0.9);
      color: rgba(255, 255, 255, 0.95);
    }

    .dark &.el-tag--dark {
      background: rgba(255, 255, 255, 0.9);
      border-color: rgba(255, 255, 255, 0.9);
      color: rgba(0, 0, 0, 0.9);
    }
  }
}

.el-badge {
  // 覆盖徽章颜色
  :deep(.el-badge__content) {
    background: rgba(0, 0, 0, 0.9);
    border-color: rgba(0, 0, 0, 0.9);
    color: rgba(255, 255, 255, 0.95);

    &.el-badge__content--success,
    &.el-badge__content--warning,
    &.el-badge__content--danger,
    &.el-badge__content--info {
      background: rgba(0, 0, 0, 0.9);
      border-color: rgba(0, 0, 0, 0.9);
    }
  }

  .dark & :deep(.el-badge__content) {
    background: rgba(255, 255, 255, 0.9);
    border-color: rgba(255, 255, 255, 0.9);
    color: rgba(0, 0, 0, 0.9);

    &.el-badge__content--success,
    &.el-badge__content--warning,
    &.el-badge__content--danger,
    &.el-badge__content--info {
      background: rgba(255, 255, 255, 0.9);
      border-color: rgba(255, 255, 255, 0.9);
    }
  }
}

// 动画定义
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slideIn {
  from {
    transform: translateX(-20px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
}

@keyframes gradient-shift {
  0%,
  100% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
}
</style>
