<template>
    <div class="flex h-screen overflow-hidden bg-bg">
        <!-- 移动端遮罩层 -->
        <Transition
            enter-active-class="transition-opacity duration-200"
            enter-from-class="opacity-0"
            enter-to-class="opacity-100"
            leave-active-class="transition-opacity duration-200"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0">
            <div
                v-if="isMobile && mobileMenuOpen"
                class="fixed inset-0 z-40 bg-black/40"
                @click="mobileMenuOpen = false" />
        </Transition>

        <!-- 侧边栏 -->
        <aside
            v-if="!isMobile"
            class="flex flex-col border-r border-border bg-surface transition-[width] duration-200"
            :class="isCollapse ? 'w-16' : 'w-[232px]'">
            <!-- 品牌区 -->
            <div class="flex h-14 items-center gap-2 border-b border-border px-4">
                <IconRobot :size="22" class="shrink-0 text-accent" aria-hidden="true" />
                <span v-if="!isCollapse" class="truncate font-semibold text-fg">onebots</span>
            </div>

            <!-- 导航区 -->
            <nav class="flex-1 space-y-0.5 overflow-y-auto p-2">
                <RouterLink
                    v-for="item in menuItems"
                    :key="item.to"
                    :to="item.to"
                    :title="isCollapse ? item.label : undefined"
                    class="flex h-9 items-center gap-2.5 rounded-control px-3 text-sm transition-colors"
                    :class="[
                        isActive(item.to)
                            ? 'bg-accent-soft font-medium text-accent'
                            : 'text-fg-secondary hover:bg-surface-raised hover:text-fg',
                        isCollapse ? 'justify-center px-0' : '',
                    ]">
                    <component :is="item.icon" :size="18" class="shrink-0" aria-hidden="true" />
                    <span v-if="!isCollapse" class="truncate">{{ item.label }}</span>
                </RouterLink>
            </nav>

            <!-- 底部操作区 -->
            <div
                class="flex items-center gap-1 border-t border-border p-2"
                :class="isCollapse ? 'flex-col' : ''">
                <button
                    type="button"
                    :title="isCollapse ? '展开侧边栏' : '折叠侧边栏'"
                    class="inline-flex h-9 w-9 items-center justify-center rounded-control text-fg-secondary transition-colors hover:bg-surface-raised hover:text-fg"
                    @click="isCollapse = !isCollapse">
                    <IconLayoutSidebarLeftExpand v-if="isCollapse" :size="18" aria-hidden="true" />
                    <IconLayoutSidebarLeftCollapse v-else :size="18" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    :title="isDark ? '切换为浅色模式' : '切换为深色模式'"
                    class="inline-flex h-9 w-9 items-center justify-center rounded-control text-fg-secondary transition-colors hover:bg-surface-raised hover:text-fg"
                    @click="toggleTheme(!isDark)">
                    <IconSun v-if="isDark" :size="18" aria-hidden="true" />
                    <IconMoon v-else :size="18" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    title="退出登录"
                    class="inline-flex h-9 w-9 items-center justify-center rounded-control text-fg-secondary transition-colors hover:bg-surface-raised hover:text-fg"
                    @click="handleLogout">
                    <IconLogout :size="18" aria-hidden="true" />
                </button>
            </div>
        </aside>

        <!-- 移动端侧边栏抽屉 -->
        <aside
            v-if="isMobile"
            class="fixed inset-y-0 left-0 z-50 flex w-[232px] flex-col border-r border-border bg-surface transition-transform duration-200"
            :class="mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'">
            <!-- 品牌区 -->
            <div class="flex h-14 items-center justify-between border-b border-border px-4">
                <div class="flex items-center gap-2">
                    <IconRobot :size="22" class="shrink-0 text-accent" aria-hidden="true" />
                    <span class="truncate font-semibold text-fg">onebots</span>
                </div>
                <button
                    type="button"
                    title="关闭菜单"
                    class="inline-flex h-9 w-9 items-center justify-center rounded-control text-fg-secondary transition-colors hover:bg-surface-raised hover:text-fg"
                    @click="mobileMenuOpen = false">
                    <IconX :size="18" aria-hidden="true" />
                </button>
            </div>

            <!-- 导航区 -->
            <nav class="flex-1 space-y-0.5 overflow-y-auto p-2">
                <RouterLink
                    v-for="item in menuItems"
                    :key="item.to"
                    :to="item.to"
                    class="flex h-9 items-center gap-2.5 rounded-control px-3 text-sm transition-colors"
                    :class="
                        isActive(item.to)
                            ? 'bg-accent-soft font-medium text-accent'
                            : 'text-fg-secondary hover:bg-surface-raised hover:text-fg'
                    ">
                    <component :is="item.icon" :size="18" class="shrink-0" aria-hidden="true" />
                    <span class="truncate">{{ item.label }}</span>
                </RouterLink>
            </nav>

            <!-- 底部操作区 -->
            <div class="flex items-center gap-1 border-t border-border p-2">
                <button
                    type="button"
                    :title="isDark ? '切换为浅色模式' : '切换为深色模式'"
                    class="inline-flex h-9 w-9 items-center justify-center rounded-control text-fg-secondary transition-colors hover:bg-surface-raised hover:text-fg"
                    @click="toggleTheme(!isDark)">
                    <IconSun v-if="isDark" :size="18" aria-hidden="true" />
                    <IconMoon v-else :size="18" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    title="退出登录"
                    class="inline-flex h-9 w-9 items-center justify-center rounded-control text-fg-secondary transition-colors hover:bg-surface-raised hover:text-fg"
                    @click="handleLogout">
                    <IconLogout :size="18" aria-hidden="true" />
                </button>
            </div>
        </aside>

        <!-- 主区 -->
        <div class="flex min-w-0 flex-1 flex-col">
            <!-- 顶栏 -->
            <header
                class="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 sm:px-6">
                <div class="flex items-center gap-2">
                    <button
                        v-if="isMobile"
                        type="button"
                        title="打开菜单"
                        class="inline-flex h-9 w-9 items-center justify-center rounded-control text-fg-secondary transition-colors hover:bg-surface-raised hover:text-fg"
                        @click="mobileMenuOpen = true">
                        <IconMenu2 :size="20" aria-hidden="true" />
                    </button>
                    <h1 class="truncate text-sm font-medium text-fg">{{ route.meta.title }}</h1>
                </div>
                <div class="flex shrink-0 items-center gap-3">
                    <RouterLink to="/system" :title="readinessProbe.detail">
                        <UiBadge :variant="readinessProbe.state" dot>
                            {{ readinessProbe.label }}
                        </UiBadge>
                    </RouterLink>
                    <button
                        type="button"
                        title="待处理验证"
                        class="relative inline-flex h-9 w-9 items-center justify-center rounded-control text-fg-secondary transition-colors hover:bg-surface-raised hover:text-fg"
                        @click="verification.requestOpenDrawer()">
                        <IconBell :size="18" aria-hidden="true" />
                        <span
                            v-if="verificationPending.length > 0"
                            class="absolute top-0.5 right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] leading-none font-medium text-white">
                            {{ verificationPending.length }}
                        </span>
                    </button>
                </div>
            </header>

            <!-- 内容区 -->
            <main class="flex min-h-0 flex-1 flex-col overflow-hidden">
                <UiAlert
                    v-if="systemInfo?.isDefaultCredentials"
                    variant="warning"
                    title="安全提示"
                    class="mx-6 mt-4 shrink-0">
                    当前使用自动生成的默认账号，存在安全风险，请尽快前往
                    <RouterLink to="/config" class="font-medium text-warning underline"
                        >配置管理</RouterLink
                    >
                    修改「管理端用户名」与「管理端密码」。
                </UiAlert>
                <div class="min-h-0 flex-1">
                    <router-view v-slot="{ Component }">
                        <Transition
                            mode="out-in"
                            enter-active-class="transition-opacity duration-[120ms]"
                            enter-from-class="opacity-0"
                            enter-to-class="opacity-100"
                            leave-active-class="transition-opacity duration-[120ms]"
                            leave-from-class="opacity-100"
                            leave-to-class="opacity-0">
                            <div :key="route.path" class="h-full">
                                <component :is="Component" />
                            </div>
                        </Transition>
                    </router-view>
                </div>
            </main>
        </div>

        <!-- 登录验证（滑块/扫码/设备锁/短信等） -->
        <VerificationPanel
            :pending="verificationPending"
            :on-approve="
                (req, data) => verification.submit(req.platform, req.account_id, req.type, data)
            "
            :on-reject="verification.dismiss"
            :request-sms="verification.requestSms"
            :should-open-drawer="verificationShouldOpen"
            :reset-open-drawer="verification.resetOpenDrawer" />
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
    IconRobot,
    IconSettings,
    IconChartBar,
    IconTerminal2,
    IconFileText,
    IconBug,
    IconPackage,
    IconPlugConnected,
    IconBell,
    IconSun,
    IconMoon,
    IconLogout,
    IconLayoutSidebarLeftCollapse,
    IconLayoutSidebarLeftExpand,
    IconMenu2,
    IconX,
} from "@tabler/icons-vue";
import { useTheme } from "../composables/useTheme";
import { useApi } from "../composables/useApi";
import { useVerification } from "../composables/useVerification";
import { logout } from "../composables/useAuth";
import UiBadge from "../ui/UiBadge.vue";
import UiAlert from "../ui/UiAlert.vue";
import VerificationPanel from "../components/VerificationPanel.vue";

const route = useRoute();
const router = useRouter();

const { isDark, toggleTheme } = useTheme();
const { readinessProbe, systemInfo } = useApi({ adapters: false });
const verification = useVerification();
const verificationPending = computed(() => verification.pending.value);
const verificationShouldOpen = computed(() => verification.shouldOpenDrawer.value);

const windowWidth = ref(typeof window !== "undefined" ? window.innerWidth : 1024);
const isMobile = computed(() => windowWidth.value < 768);
const mobileMenuOpen = ref(false);
const isCollapse = ref(typeof window !== "undefined" && window.innerWidth < 768);

let onResize: (() => void) | undefined;
onMounted(() => {
    onResize = () => {
        windowWidth.value = window.innerWidth;
    };
    window.addEventListener("resize", onResize);
});
onUnmounted(() => {
    if (onResize) {
        window.removeEventListener("resize", onResize);
    }
});

// 路由变化时关闭移动端抽屉
watch(
    () => route.path,
    () => {
        if (isMobile.value) {
            mobileMenuOpen.value = false;
        }
    },
);

const menuItems = [
    { to: "/bots", label: "机器人管理", icon: IconRobot },
    { to: "/extensions", label: "功能扩展", icon: IconPackage },
    { to: "/frameworks", label: "解决方案", icon: IconPlugConnected },
    { to: "/config", label: "配置管理", icon: IconSettings },
    { to: "/system", label: "系统信息", icon: IconChartBar },
    { to: "/terminal", label: "Web 控制台", icon: IconTerminal2 },
    { to: "/logs", label: "系统日志", icon: IconFileText },
    { to: "/message-debug", label: "消息调试", icon: IconBug },
];

const isActive = (path: string) => route.path === path || route.path.startsWith(`${path}/`);

const handleLogout = async () => {
    await logout();
    router.replace("/login");
};
</script>
