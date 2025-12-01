<template>
  <el-scrollbar class="page-scrollbar">
    <div class="page-content">
      <div class="page-header">
        <h2>
          <el-icon><Document /></el-icon>
          系统日志
        </h2>
        <el-space>
          <el-button type="danger" :icon="Delete" @click="clearLogs">
            清空
          </el-button>
          <el-button
            v-if="!isConnected"
            type="primary"
            :icon="Connection"
            @click="reconnect"
          >
            重新连接
          </el-button>
          <el-tag :type="isConnected ? 'success' : 'danger'">
            {{ isConnected ? '已连接' : '未连接' }}
          </el-tag>
        </el-space>
      </div>
      <el-card shadow="never" class="logs-card">
        <div ref="logsContainer" class="logs-container"></div>
      </el-card>
    </div>
  </el-scrollbar>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Document, Delete, Connection } from '@element-plus/icons-vue'
import '@xterm/xterm/css/xterm.css'

const isDev = process.env.NODE_ENV === 'development'
const API_BASE = isDev ? '' : 'http://localhost:6727'

const logsContainer = ref<HTMLElement>()
let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let eventSource: EventSource | null = null
const isConnected = ref(false)

const clearLogs = () => {
  terminal?.clear()
}

const reconnect = () => {
  connectSSE()
}

const connectSSE = () => {
  if (eventSource) {
    eventSource.close()
  }
  
  eventSource = new EventSource(`${API_BASE}/api/logs`)
  
  eventSource.onopen = () => {
    isConnected.value = true
    console.log('日志流已连接')
  }
  
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (terminal && data.message) {
        terminal.write(data.message)
      }
    } catch (error) {
      console.error('解析日志数据失败:', error)
    }
  }
  
  eventSource.onerror = () => {
    isConnected.value = false
    console.error('SSE 连接错误')
    eventSource?.close()
    setTimeout(reconnect, 3000)
  }
}

onMounted(() => {
  if (logsContainer.value) {
    terminal = new Terminal({
      disableStdin: true,
      cursorBlink: false,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4'
      }
    })
    
    fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())
    
    terminal.open(logsContainer.value)
    fitAddon.fit()
    
    window.addEventListener('resize', () => {
      fitAddon?.fit()
    })
    
    connectSSE()
  }
})

onUnmounted(() => {
  eventSource?.close()
  terminal?.dispose()
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

.logs-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;

  :deep(.el-card__body) {
    padding: 0;
  }

  .logs-container {
    width: 100%;
    height: calc(100vh - 200px);
    padding: 16px;
    background: #1e1e1e;
  }
}
</style>
