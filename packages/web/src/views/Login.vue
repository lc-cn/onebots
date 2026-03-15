<template>
  <div class="login-page">
    <el-card class="login-card" shadow="hover">
      <div class="login-title">onebots 管理平台</div>
      <el-tabs v-model="loginMode" class="login-tabs">
        <el-tab-pane label="鉴权码" name="token">
          <el-form :model="form" @submit.prevent="handleLogin">
            <el-form-item>
              <el-input
                v-model="form.accessToken"
                type="password"
                placeholder="Bearer 鉴权码（config 中 access_token）"
                autocomplete="off"
                show-password
                clearable
              />
            </el-form-item>
            <el-button type="primary" :loading="loading" class="login-button" @click="handleLogin">
              登录
            </el-button>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="用户名 / 密码" name="password">
          <el-form :model="form" @submit.prevent="handleLogin">
            <el-form-item>
              <el-input v-model="form.username" placeholder="用户名" autocomplete="username" />
            </el-form-item>
            <el-form-item>
              <el-input
                v-model="form.password"
                type="password"
                placeholder="密码"
                autocomplete="current-password"
                show-password
              />
            </el-form-item>
            <el-button type="primary" :loading="loading" class="login-button" @click="handleLogin">
              登录
            </el-button>
          </el-form>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { login, loginWithToken } from '../composables/useAuth'

const router = useRouter()
const route = useRoute()

const loginMode = ref<'token' | 'password'>('token')
const form = reactive({
  accessToken: '',
  username: '',
  password: ''
})
const loading = ref(false)

onMounted(() => {
  const reason = route.query.reason
  if (reason === 'expired') {
    ElMessage.warning('登录已过期，请重新登录')
  } else if (reason === 'unauthorized') {
    ElMessage.warning('请先登录')
  }
})

const handleLogin = async () => {
  if (loginMode.value === 'token') {
    if (!form.accessToken?.trim()) {
      ElMessage.warning('请输入鉴权码')
      return
    }
    loading.value = true
    const result = await loginWithToken(form.accessToken)
    loading.value = false
    if (!result.ok) {
      ElMessage.error(result.message)
      return
    }
  } else {
    if (!form.username || !form.password) {
      ElMessage.warning('请输入用户名和密码')
      return
    }
    loading.value = true
    const result = await login(form.username, form.password)
    loading.value = false
    if (!result.ok) {
      ElMessage.error(result.message)
      return
    }
    if (result.isDefaultCredentials) {
      ElMessage.warning({
        message: '当前为自动生成的默认账号，存在安全风险，请尽快在「系统」或「配置」中修改用户名与密码。',
        duration: 8000,
        showClose: true,
      })
    }
  }

  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  router.replace(redirect)
}
</script>

<style lang="scss" scoped>
.login-page {
  width: 100%;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-color);
}

.login-card {
  width: 360px;
  border: 1px solid var(--border-color);
  background: var(--card-bg);
}

.login-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 16px;
  text-align: center;
}

.login-tabs {
  margin-top: 8px;
}

.login-button {
  width: 100%;
}
</style>
