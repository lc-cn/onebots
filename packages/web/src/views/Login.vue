<template>
    <div
        class="flex h-screen items-center justify-center bg-bg bg-[radial-gradient(ellipse_at_top,var(--accent-soft),transparent_60%)] px-4">
        <div
            class="w-full max-w-[380px] rounded-card border border-border bg-surface p-6 shadow-lg">
            <!-- 品牌区 -->
            <div class="mb-6 flex flex-col items-center gap-3">
                <span
                    class="flex size-12 items-center justify-center rounded-card bg-accent-soft text-accent">
                    <IconRobot :size="28" stroke="1.5" />
                </span>
                <h1 class="text-lg font-semibold text-fg">onebots 管理平台</h1>
            </div>

            <!-- 登录方式切换（分段控件） -->
            <div class="mb-5 flex rounded-control bg-surface-raised p-1" role="tablist">
                <button
                    v-for="mode in loginModes"
                    :key="mode.key"
                    type="button"
                    role="tab"
                    :aria-selected="loginMode === mode.key"
                    class="h-8 flex-1 rounded-[calc(var(--radius-control)-4px)] text-sm transition-opacity"
                    :class="
                        loginMode === mode.key
                            ? 'bg-surface font-medium text-fg shadow-sm'
                            : 'text-fg-secondary hover:opacity-80'
                    "
                    @click="loginMode = mode.key">
                    {{ mode.label }}
                </button>
            </div>

            <!-- 鉴权码登录 -->
            <form
                v-if="loginMode === 'token'"
                class="flex flex-col gap-4"
                @submit.prevent="handleLogin">
                <UiInput
                    v-model="form.accessToken"
                    type="password"
                    placeholder="Bearer 鉴权码（config 中 access_token）"
                    autocomplete="off"
                    clearable />
                <UiButton variant="primary" type="submit" :loading="loading" class="w-full">
                    登录
                </UiButton>
            </form>

            <!-- 用户名 / 密码登录 -->
            <form v-else class="flex flex-col gap-4" @submit.prevent="handleLogin">
                <UiInput v-model="form.username" placeholder="用户名" autocomplete="username" />
                <UiInput
                    v-model="form.password"
                    type="password"
                    placeholder="密码"
                    autocomplete="current-password" />
                <UiButton variant="primary" type="submit" :loading="loading" class="w-full">
                    登录
                </UiButton>
            </form>
        </div>
    </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { IconRobot } from "@tabler/icons-vue";
import UiButton from "../ui/UiButton.vue";
import UiInput from "../ui/UiInput.vue";
import { useToast } from "../ui/toast";
import { login, loginWithToken } from "../composables/useAuth";

const router = useRouter();
const route = useRoute();
const toast = useToast();

const loginModes = [
    { key: "token", label: "鉴权码" },
    { key: "password", label: "用户名 / 密码" },
] as const;

const loginMode = ref<"token" | "password">("token");
const form = reactive({
    accessToken: "",
    username: "",
    password: "",
});
const loading = ref(false);

onMounted(() => {
    const reason = route.query.reason;
    if (reason === "expired") {
        toast.warning("登录已过期，请重新登录");
    } else if (reason === "unauthorized") {
        toast.warning("请先登录");
    } else if (reason === "invalid_token") {
        toast.error("链接中的鉴权码无效，未写入本地会话");
    } else if (reason === "token_unavailable") {
        toast.warning("暂时无法验证链接中的鉴权码，请手动登录");
    }
});

const handleLogin = async () => {
    if (loginMode.value === "token") {
        if (!form.accessToken?.trim()) {
            toast.warning("请输入鉴权码");
            return;
        }
        loading.value = true;
        const result = await loginWithToken(form.accessToken);
        loading.value = false;
        if (!result.ok) {
            toast.error(result.message);
            return;
        }
    } else {
        if (!form.username || !form.password) {
            toast.warning("请输入用户名和密码");
            return;
        }
        loading.value = true;
        const result = await login(form.username, form.password);
        loading.value = false;
        if (!result.ok) {
            toast.error(result.message);
            return;
        }
        if (result.isDefaultCredentials) {
            toast.warning(
                "当前为自动生成的默认账号，存在安全风险，请尽快在「系统」或「配置」中修改用户名与密码。",
                8000,
            );
        }
    }

    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/";
    router.replace(redirect);
};
</script>
