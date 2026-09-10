<script setup lang="ts">
import type { ControlStatus } from "@onebots/core/control";
import {
    IconAlertTriangle,
    IconCircleCheck,
    IconLogout,
    IconMoon,
    IconRefresh,
    IconRobot,
    IconSun,
} from "@tabler/icons-vue";
import { workspaceNavigation, type Workspace } from "../control-workspace.js";

defineProps<{
    active: Workspace;
    state?: ControlStatus;
    error: string;
    notice: string;
    isDark: boolean;
}>();
const emit = defineEmits<{
    select: [workspace: Workspace];
    refresh: [];
    logout: [];
    toggleTheme: [];
    dismissNotice: [];
}>();
</script>

<template>
    <div class="console-shell">
        <aside class="sidebar">
            <div class="brand-lockup sidebar-brand">
                <span class="brand-mark"><IconRobot :size="21" /></span>
                <div><strong>onebots</strong><small>control plane</small></div>
            </div>
            <nav class="primary-nav" aria-label="控制台导航">
                <button
                    v-for="item in workspaceNavigation"
                    :key="item.id"
                    type="button"
                    :class="{ active: active === item.id }"
                    :aria-current="active === item.id ? 'page' : undefined"
                    @click="emit('select', item.id)">
                    <component :is="item.icon" :size="19" />
                    <span
                        ><strong>{{ item.label }}</strong
                        ><small>{{ item.hint }}</small></span
                    >
                </button>
            </nav>
            <div class="sidebar-status">
                <span
                    class="status-dot"
                    :class="{ online: !error && !!state, failed: !!error }"></span>
                <span
                    ><strong>{{
                        error ? "管理状态待确认" : state ? "管理服务在线" : "正在连接管理服务"
                    }}</strong
                    ><small>v{{ state?.manager.version ?? "—" }}</small></span
                >
            </div>
            <div class="sidebar-actions">
                <button
                    type="button"
                    class="icon-button"
                    aria-label="刷新状态"
                    @click="emit('refresh')">
                    <IconRefresh :size="18" />
                </button>
                <button
                    type="button"
                    class="icon-button"
                    aria-label="切换主题"
                    @click="emit('toggleTheme')">
                    <IconSun v-if="isDark" :size="18" /><IconMoon v-else :size="18" />
                </button>
                <button
                    type="button"
                    class="icon-button"
                    aria-label="退出登录"
                    @click="emit('logout')">
                    <IconLogout :size="18" />
                </button>
            </div>
        </aside>

        <div class="console-main">
            <header class="mobile-header">
                <div class="brand-lockup">
                    <span class="brand-mark"><IconRobot :size="19" /></span><strong>onebots</strong>
                </div>
                <div class="flex gap-1">
                    <button
                        type="button"
                        class="icon-button"
                        aria-label="切换主题"
                        @click="emit('toggleTheme')">
                        <IconSun v-if="isDark" :size="17" /><IconMoon v-else :size="17" />
                    </button>
                    <button
                        type="button"
                        class="icon-button"
                        aria-label="退出登录"
                        @click="emit('logout')">
                        <IconLogout :size="17" />
                    </button>
                </div>
            </header>
            <nav class="mobile-nav" aria-label="控制台导航">
                <button
                    v-for="item in workspaceNavigation"
                    :key="item.id"
                    type="button"
                    :class="{ active: active === item.id }"
                    @click="emit('select', item.id)">
                    <component :is="item.icon" :size="17" />{{ item.label }}
                </button>
            </nav>
            <div id="main-content" class="workspace-scroll" tabindex="-1">
                <div class="workspace">
                    <div v-if="error" role="alert" class="feedback feedback-error sticky-feedback">
                        <IconAlertTriangle :size="18" /><span>{{ error }}</span
                        ><button type="button" @click="emit('refresh')">重试</button>
                    </div>
                    <div
                        v-else-if="notice"
                        role="status"
                        class="feedback feedback-success sticky-feedback">
                        <IconCircleCheck :size="18" /><span>{{ notice }}</span
                        ><button type="button" @click="emit('dismissNotice')">关闭</button>
                    </div>
                    <slot />
                </div>
            </div>
        </div>
    </div>
</template>
