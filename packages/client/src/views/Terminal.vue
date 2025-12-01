<template>
  <el-scrollbar class="page-scrollbar">
    <div class="page-content">
      <div class="page-header">
        <h2>
          <el-icon><Monitor /></el-icon>
          Web 控制台
        </h2>
        <el-space>
          <el-button type="danger" :icon="Delete" @click="clearTerminal">
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
          <el-button type="warning" @click="restartServer" style="margin-left: 8px;">
            重启服务
          </el-button>
          <el-tag :type="isConnected ? 'success' : 'danger'">
            {{ isConnected ? '已连接' : '未连接' }}
          </el-tag>
        </el-space>
      </div>
      <el-card shadow="never" class="terminal-card">
        <div ref="terminalContainer" class="terminal-container"></div>
      </el-card>
    </div>
  </el-scrollbar>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Monitor, Delete, Connection } from '@element-plus/icons-vue'
import '@xterm/xterm/css/xterm.css'

const isDev = process.env.NODE_ENV === 'development'
const WS_BASE = isDev ? 'ws://localhost:6727' : `ws://${window.location.hostname}:6727`

const terminalContainer = ref<HTMLElement>()
let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let ws: WebSocket | null = null
const isConnected = ref(false)

const clearTerminal = () => {
  terminal?.clear()
}

const reconnect = () => {
  connectWebSocket()
}

const connectWebSocket = () => {
  if (ws) {
    ws.close()
  }
  
  ws = new WebSocket(`${WS_BASE}/api/terminal`)
  
  ws.onopen = () => {
    isConnected.value = true
    console.log('终端已连接')
  }
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (data.type === 'output' && terminal) {
        terminal.write(data.data)
      } else if (data.type === 'exit') {
        terminal?.writeln('\r\n\x1b[31m[终端已退出]\x1b[0m')
        isConnected.value = false
      }
    } catch (error) {
      console.error('解析终端数据失败:', error)
    }
  }
  
  ws.onerror = (error) => {
    console.error('WebSocket 错误:', error)
  }
  
  ws.onclose = () => {
    isConnected.value = false
    console.log('终端连接已关闭')
    setTimeout(reconnect, 3000)
  }
}

const restartServer = () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'restart' }))
    terminal?.writeln('\r\n\x1b[33m[服务重启指令已发送]\x1b[0m')
  }
}

onMounted(() => {
  if (terminalContainer.value) {
    terminal = new Terminal({
      cursorBlink: true,
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
    
    terminal.open(terminalContainer.value)
    fitAddon.fit()
    
    // 监听用户输入
    terminal.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })
    
    // 监听终端尺寸变化
    const resizeHandler = () => {
      fitAddon?.fit()
      if (ws && ws.readyState === WebSocket.OPEN && terminal) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols: terminal.cols,
          rows: terminal.rows
        }))
      }
    }
    
    window.addEventListener('resize', resizeHandler)
    
    connectWebSocket()
  }
})

onUnmounted(() => {
  ws?.close()
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

.terminal-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;

  :deep(.el-card__body) {
    padding: 0;
  }

  .terminal-container {
    width: 100%;
    height: calc(100vh - 200px);
    padding: 16px;
    background: #1e1e1e;
  }
}
</style>
