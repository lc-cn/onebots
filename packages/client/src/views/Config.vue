<template>
  <el-scrollbar class="page-scrollbar">
    <div class="page-content">
      <div class="page-header">
        <h2>
          <el-icon><Setting /></el-icon>
          配置管理
        </h2>
        <el-space>
          <el-button type="success" :icon="Refresh" @click="handleReload">
            重载配置
          </el-button>
          <el-button type="primary" :icon="Check" @click="handleSave">
            保存配置
          </el-button>
        </el-space>
      </div>
      <el-card shadow="never" class="config-card">
        <el-input
          v-model="config"
          type="textarea"
          :autosize="{ minRows: 25, maxRows: 40 }"
          placeholder="配置内容"
          class="config-textarea"
        />
      </el-card>
    </div>
  </el-scrollbar>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Setting, Refresh, Check } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

const isDev = process.env.NODE_ENV === 'development'
const API_BASE = isDev ? '' : 'http://localhost:6727'

const config = ref<string>('')

const loadConfig = async () => {
  try {
    const response = await fetch(`${API_BASE}/api/config`)
    if (response.ok) {
      config.value = await response.text()
    }
  } catch (error) {
    console.error('加载配置失败:', error)
    ElMessage.error('加载配置失败')
  }
}

const handleReload = () => {
  ElMessage.info('正在重载配置...')
  loadConfig()
}

const handleSave = async () => {
  try {
    const response = await fetch(`${API_BASE}/api/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: config.value
    })
    if (response.ok) {
      const result = await response.json()
      ElMessage.success(result.message || '配置已保存')
    } else {
      const result = await response.json()
      ElMessage.error(result.message || '保存失败')
    }
  } catch (error) {
    console.error('保存配置失败:', error)
    ElMessage.error('保存配置失败')
  }
}

onMounted(() => {
  loadConfig()
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

.config-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 4px;

  :deep(.el-card__body) {
    padding: 0;
  }

  .config-textarea {
    :deep(textarea) {
      background: var(--card-bg);
      border: none;
      color: var(--text-primary);
      font-family: 'Courier New', 'Monaco', monospace;
      font-size: 13px;
      line-height: 1.6;
      padding: 16px;
      resize: none;

      &:focus {
        outline: none;
        box-shadow: none;
      }

      &::placeholder {
        color: var(--text-secondary);
      }
    }
  }
}
</style>
