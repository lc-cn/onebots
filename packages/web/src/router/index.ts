import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { isAuthenticated, hasExpiredFlag, clearExpiredFlag } from '../composables/useAuth'

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
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to) => {
  if (to.meta?.public) return true
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
