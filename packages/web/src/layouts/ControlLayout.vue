<script setup lang="ts">
import { computed } from "vue";
import type { ControlStatus } from "@onebots/core/control";
import type { ControlMutationBlock } from "../control-product-state.js";
import {
    IconAlertTriangle,
    IconCircleCheck,
    IconLogout,
    IconMoon,
    IconRefresh,
    IconSun,
} from "@tabler/icons-vue";
import { workspaceHash, workspaceNavigation, type Workspace } from "../control-workspace.js";

const emit = defineEmits<{
    select: [workspace: Workspace];
    refresh: [];
    logout: [];
    toggleTheme: [];
    dismissNotice: [];
}>();
const props = defineProps<{
    active: Workspace;
    state?: ControlStatus;
    error: string;
    notice: string;
    isDark: boolean;
    mutationBlock?: ControlMutationBlock;
    pendingVerificationCount?: number;
}>();
const activeItem = computed(() => workspaceNavigation.find(item => item.id === props.active));

function navigate(event: MouseEvent, workspace: Workspace) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
    event.preventDefault();
    emit("select", workspace);
}
</script>

<template>
    <div class="console-shell">
        <aside class="sidebar">
            <div class="brand-lockup sidebar-brand">
                <span class="brand-mark" aria-hidden="true">OB</span>
                <div><strong>onebots</strong><small>管理控制台</small></div>
            </div>
            <nav class="primary-nav" aria-label="控制台导航">
                <p class="nav-section-label">工作区</p>
                <a
                    v-for="item in workspaceNavigation"
                    :key="item.id"
                    :href="workspaceHash(item.id)"
                    :class="{ active: active === item.id }"
                    :aria-current="active === item.id ? 'page' : undefined"
                    @click="navigate($event, item.id)">
                    <component :is="item.icon" :size="19" aria-hidden="true" />
                    <span
                        ><strong>{{ item.label }}</strong></span
                    >
                    <em
                        v-if="item.id === 'activity' && pendingVerificationCount"
                        class="nav-count"
                        :aria-label="`${pendingVerificationCount} 个待处理验证`"
                        >{{ pendingVerificationCount }}</em
                    >
                </a>
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
                    <IconRefresh :size="18" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    class="icon-button"
                    aria-label="切换主题"
                    @click="emit('toggleTheme')">
                    <IconSun v-if="isDark" :size="18" aria-hidden="true" /><IconMoon
                        v-else
                        :size="18"
                        aria-hidden="true" />
                </button>
                <button
                    type="button"
                    class="icon-button"
                    aria-label="退出登录"
                    @click="emit('logout')">
                    <IconLogout :size="18" aria-hidden="true" />
                </button>
            </div>
        </aside>

        <div class="console-main">
            <header class="desktop-header">
                <div class="workspace-crumb">
                    <span>管理控制台</span><i>/</i><strong>{{ activeItem?.label }}</strong>
                </div>
                <div class="desktop-header-actions">
                    <span class="header-health" :class="{ failed: !!error }">
                        <span
                            class="status-dot"
                            :class="error ? 'failed' : state ? 'online' : ''"></span>
                        {{ error ? "状态待确认" : state ? "管理服务在线" : "正在连接" }}
                    </span>
                    <button
                        type="button"
                        class="icon-button"
                        aria-label="刷新状态"
                        @click="emit('refresh')">
                        <IconRefresh :size="17" aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        class="icon-button"
                        aria-label="切换主题"
                        @click="emit('toggleTheme')">
                        <IconSun v-if="isDark" :size="17" aria-hidden="true" /><IconMoon
                            v-else
                            :size="17"
                            aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        class="icon-button"
                        aria-label="退出登录"
                        @click="emit('logout')">
                        <IconLogout :size="17" aria-hidden="true" />
                    </button>
                </div>
            </header>
            <header class="mobile-header">
                <div class="brand-lockup">
                    <span class="brand-mark" aria-hidden="true">OB</span><strong>onebots</strong>
                </div>
                <div class="flex gap-1">
                    <button
                        type="button"
                        class="icon-button"
                        aria-label="切换主题"
                        @click="emit('toggleTheme')">
                        <IconSun v-if="isDark" :size="17" aria-hidden="true" /><IconMoon
                            v-else
                            :size="17"
                            aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        class="icon-button"
                        aria-label="退出登录"
                        @click="emit('logout')">
                        <IconLogout :size="17" aria-hidden="true" />
                    </button>
                </div>
            </header>
            <nav class="mobile-nav" aria-label="控制台导航">
                <a
                    v-for="item in workspaceNavigation"
                    :key="item.id"
                    :href="workspaceHash(item.id)"
                    :class="{ active: active === item.id }"
                    :aria-current="active === item.id ? 'page' : undefined"
                    @click="navigate($event, item.id)">
                    <component :is="item.icon" :size="17" aria-hidden="true" />{{ item.label
                    }}<em
                        v-if="item.id === 'activity' && pendingVerificationCount"
                        class="nav-count"
                        >{{ pendingVerificationCount }}</em
                    >
                </a>
            </nav>
            <div id="main-content" class="workspace-scroll" tabindex="-1">
                <div class="workspace">
                    <div
                        v-if="mutationBlock"
                        role="alert"
                        class="feedback feedback-error global-blocker">
                        <IconAlertTriangle :size="19" />
                        <span
                            ><strong>{{ mutationBlock.title }}</strong
                            >{{ mutationBlock.detail }}</span
                        >
                        <button type="button" @click="emit('select', 'activity')">打开诊断</button>
                    </div>
                    <div
                        v-if="pendingVerificationCount"
                        role="status"
                        class="feedback verification-alert">
                        <IconAlertTriangle :size="18" />
                        <span
                            ><strong>{{ pendingVerificationCount }} 个账号验证等待处理</strong
                            >平台登录正在等待人工输入，处理前账号可能无法上线。</span
                        >
                        <button type="button" @click="emit('select', 'activity')">立即处理</button>
                    </div>
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
