<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ControlStatus } from "@onebots/core/control";
import type { ControlMutationBlock } from "../control-product-state.js";
import {
    IconAlertTriangle,
    IconCircleCheck,
    IconLogout,
    IconMenu2,
    IconMoon,
    IconRefresh,
    IconSun,
} from "@tabler/icons-vue";
import {
    workspacePath,
    workspaceNavigation,
    systemNavigation,
    type Workspace,
} from "../control-workspace.js";

const emit = defineEmits<{
    select: [workspace: Workspace];
    refresh: [];
    logout: [];
    toggleTheme: [];
    dismissError: [];
    dismissNotice: [];
}>();
const props = defineProps<{
    active: Workspace;
    state?: ControlStatus;
    error: string;
    statusError: string;
    actionError: string;
    inlineStatusError: boolean;
    notice: string;
    isDark: boolean;
    mutationBlock?: ControlMutationBlock;
    pendingVerificationCount?: number;
}>();
const activeItem = computed(
    () =>
        [...workspaceNavigation, systemNavigation].find(item => item.id === props.active) ??
        (props.active === "terminal" ? { label: "本地终端" } : undefined),
);
const mobileMenuTrigger = ref<HTMLButtonElement>();
const mobileMenuDialog = ref<HTMLDialogElement>();
let mobileMenuQuery: MediaQueryList | undefined;

function closeMobileMenu() {
    if (mobileMenuDialog.value?.open) mobileMenuDialog.value.close();
}

function onMobileMenuClose() {
    if (mobileMenuQuery?.matches && mobileMenuTrigger.value?.isConnected)
        mobileMenuTrigger.value.focus();
}

function onMobileBreakpointChange() {
    closeMobileMenu();
}

onMounted(() => {
    mobileMenuQuery = matchMedia("(max-width: 640px)");
    mobileMenuQuery.addEventListener("change", onMobileBreakpointChange);
});
watch(() => props.active, closeMobileMenu);
onBeforeUnmount(() => {
    mobileMenuQuery?.removeEventListener("change", onMobileBreakpointChange);
    closeMobileMenu();
});

function navigate(event: MouseEvent, workspace: Workspace) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
    event.preventDefault();
    closeMobileMenu();
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
                    :href="workspacePath(item.id)"
                    :class="{ active: active === item.id }"
                    :aria-current="active === item.id ? 'page' : undefined"
                    @click="navigate($event, item.id)">
                    <component :is="item.icon" :size="19" aria-hidden="true" />
                    <span
                        ><strong>{{ item.label }}</strong></span
                    >
                    <em
                        v-if="item.id === 'todo' && pendingVerificationCount"
                        class="nav-count"
                        :aria-label="`${pendingVerificationCount} 个待处理验证`"
                        >{{ pendingVerificationCount }}</em
                    >
                </a>
            </nav>
            <nav class="secondary-nav" aria-label="系统设置">
                <a
                    :href="workspacePath(systemNavigation.id)"
                    :class="{ active: active === systemNavigation.id || active === 'terminal' }"
                    :aria-current="
                        active === systemNavigation.id || active === 'terminal' ? 'page' : undefined
                    "
                    @click="navigate($event, systemNavigation.id)">
                    <component :is="systemNavigation.icon" :size="19" aria-hidden="true" />
                    <strong>{{ systemNavigation.label }}</strong>
                </a>
            </nav>
            <div class="sidebar-status">
                <span
                    class="status-dot"
                    :class="{ online: !statusError && !!state, failed: !!statusError }"></span>
                <span
                    ><strong>{{
                        statusError ? "管理状态待确认" : state ? "管理服务在线" : "正在连接管理服务"
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
                    <span class="header-health" :class="{ failed: !!statusError }">
                        <span
                            class="status-dot"
                            :class="statusError ? 'failed' : state ? 'online' : ''"></span>
                        {{ statusError ? "状态待确认" : state ? "管理服务在线" : "正在连接" }}
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
                <span class="mobile-current-workspace">{{ activeItem?.label }}</span>
                <div class="mobile-header-actions flex gap-1">
                    <a
                        :href="workspacePath('system')"
                        class="icon-button"
                        aria-label="系统设置"
                        @click="navigate($event, 'system')"
                        ><component :is="systemNavigation.icon" :size="17" aria-hidden="true"
                    /></a>
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
                <button
                    ref="mobileMenuTrigger"
                    type="button"
                    class="mobile-menu-trigger icon-button"
                    aria-label="打开导航菜单"
                    aria-haspopup="dialog"
                    aria-controls="mobile-navigation-dialog"
                    @click="mobileMenuDialog?.showModal()">
                    <IconMenu2 :size="21" aria-hidden="true" />
                </button>
            </header>
            <nav class="mobile-nav" aria-label="控制台导航">
                <a
                    v-for="item in workspaceNavigation"
                    :key="item.id"
                    :href="workspacePath(item.id)"
                    :class="{ active: active === item.id }"
                    :aria-current="active === item.id ? 'page' : undefined"
                    @click="navigate($event, item.id)">
                    <component :is="item.icon" :size="17" aria-hidden="true" />{{ item.label
                    }}<em v-if="item.id === 'todo' && pendingVerificationCount" class="nav-count">{{
                        pendingVerificationCount
                    }}</em>
                </a>
            </nav>
            <dialog
                id="mobile-navigation-dialog"
                ref="mobileMenuDialog"
                class="mobile-navigation-dialog"
                aria-label="导航与管理操作"
                @click.self="closeMobileMenu"
                @close="onMobileMenuClose">
                <div class="mobile-navigation-sheet">
                    <div class="mobile-navigation-head">
                        <strong>前往</strong>
                        <button type="button" @click="closeMobileMenu">关闭</button>
                    </div>
                    <nav class="mobile-navigation-links" aria-label="控制台导航">
                        <a
                            v-for="item in workspaceNavigation"
                            :key="item.id"
                            :href="workspacePath(item.id)"
                            :class="{ active: active === item.id }"
                            :aria-current="active === item.id ? 'page' : undefined"
                            @click="navigate($event, item.id)">
                            <component :is="item.icon" :size="20" aria-hidden="true" />
                            <span
                                ><strong>{{ item.label }}</strong
                                ><small>{{ item.hint }}</small></span
                            >
                            <em
                                v-if="item.id === 'todo' && pendingVerificationCount"
                                class="nav-count"
                                :aria-label="`${pendingVerificationCount} 个待处理验证`"
                                >{{ pendingVerificationCount }}</em
                            >
                        </a>
                        <a
                            :href="workspacePath(systemNavigation.id)"
                            :class="{ active: active === 'system' || active === 'terminal' }"
                            :aria-current="
                                active === 'system' || active === 'terminal' ? 'page' : undefined
                            "
                            @click="navigate($event, systemNavigation.id)">
                            <component :is="systemNavigation.icon" :size="20" aria-hidden="true" />
                            <span
                                ><strong>{{ systemNavigation.label }}</strong
                                ><small>{{ systemNavigation.hint }}</small></span
                            >
                        </a>
                    </nav>
                    <div class="mobile-navigation-actions" aria-label="管理操作">
                        <button
                            type="button"
                            @click="
                                closeMobileMenu();
                                emit('refresh');
                            ">
                            <IconRefresh :size="18" aria-hidden="true" />刷新状态
                        </button>
                        <button
                            type="button"
                            @click="
                                closeMobileMenu();
                                emit('toggleTheme');
                            ">
                            <IconSun v-if="isDark" :size="18" aria-hidden="true" /><IconMoon
                                v-else
                                :size="18"
                                aria-hidden="true" />切换主题
                        </button>
                        <button
                            type="button"
                            @click="
                                closeMobileMenu();
                                emit('logout');
                            ">
                            <IconLogout :size="18" aria-hidden="true" />退出登录
                        </button>
                    </div>
                </div>
            </dialog>
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
                        v-if="pendingVerificationCount && active !== 'todo'"
                        role="status"
                        class="feedback verification-alert">
                        <IconAlertTriangle :size="18" />
                        <span
                            ><strong>{{ pendingVerificationCount }} 项账号验证待处理</strong></span
                        >
                        <button type="button" @click="emit('select', 'todo')">立即处理</button>
                    </div>
                    <div
                        v-if="error && !(inlineStatusError && !actionError)"
                        role="alert"
                        class="feedback feedback-error sticky-feedback">
                        <IconAlertTriangle :size="18" /><span>{{ error }}</span
                        ><button
                            type="button"
                            @click="actionError ? emit('dismissError') : emit('refresh')">
                            {{ actionError ? "关闭" : "重试" }}
                        </button>
                    </div>
                    <div
                        v-else-if="!error && notice"
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
