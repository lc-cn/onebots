import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { isAuthenticated, hasExpiredFlag, clearExpiredFlag, loginWithToken } from '../composables/useAuth'
import { resolveQueryTokenNavigation } from './query-token-navigation.js'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue'),
    meta: { title: '登录', public: true }
  },
  {
    path: '/',
    component: () => import('../layouts/MainLayout.vue'),
    redirect: '/bots',
    children: [
      {
        path: 'bots',
        name: 'Bots',
        component: () => import('../views/Bots.vue'),
        meta: { title: '机器人管理', icon: 'Monitor' }
      },
      {
        path: 'extensions',
        name: 'Extensions',
        component: () => import('../views/Extensions.vue'),
        meta: { title: '功能扩展', icon: 'Package' }
      },
      {
        path: 'frameworks',
        name: 'Frameworks',
        component: () => import('../views/Frameworks.vue'),
        meta: { title: '框架接入', icon: 'PlugConnected' }
      },
      {
        path: 'config',
        name: 'Config',
        component: () => import('../views/Config.vue'),
        meta: { title: '配置管理', icon: 'Setting' }
      },
      {
        path: 'system',
        name: 'System',
        component: () => import('../views/System.vue'),
        meta: { title: '系统信息', icon: 'DataAnalysis' }
      },
      {
        path: 'terminal',
        name: 'Terminal',
        component: () => import('../views/Terminal.vue'),
        meta: { title: 'Web 控制台', icon: 'Monitor' }
      },
      {
        path: 'logs',
        name: 'Logs',
        component: () => import('../views/Logs.vue'),
        meta: { title: '系统日志', icon: 'Document' }
      },
      {
        path: 'message-debug',
        name: 'MessageDebug',
        component: () => import('../views/MessageDebug.vue'),
        meta: { title: '消息调试', icon: 'Bug' }
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach(async (to) => {
  if (to.meta?.public) return true
  const tokenNavigation = await resolveQueryTokenNavigation(to, {
    authenticate: loginWithToken,
    hasExistingSession: isAuthenticated
  })
  if (tokenNavigation) return tokenNavigation
  if (isAuthenticated()) return true
  const expired = hasExpiredFlag()
  if (expired) clearExpiredFlag()
  return {
    path: '/login',
    query: {
      redirect: to.fullPath,
      reason: expired ? 'expired' : 'unauthorized'
    }
  }
})

export default router
