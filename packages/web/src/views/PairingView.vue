<script setup lang="ts">
import {
    IconAlertTriangle,
    IconChevronRight,
    IconMoon,
    IconRobot,
    IconSun,
} from "@tabler/icons-vue";
import UiButton from "../ui/UiButton.vue";
import UiInput from "../ui/UiInput.vue";

defineProps<{ busy: boolean; error: string; isDark: boolean }>();
const code = defineModel<string>({ required: true });
const emit = defineEmits<{ pair: []; toggleTheme: [] }>();
</script>

<template>
    <main class="auth-shell">
        <section class="auth-story" aria-labelledby="auth-title">
            <div class="brand-lockup">
                <span class="brand-mark"><IconRobot :size="23" /></span>
                <span>onebots</span>
            </div>
            <div class="auth-story-copy">
                <p class="eyebrow">SELF-HOSTED IM GATEWAY</p>
                <h1 id="auth-title">连接你的<br />消息基础设施</h1>
                <p>管理服务持续在线，网关按需运行。所有账号、协议与扩展都留在你的工作区。</p>
            </div>
            <div class="auth-signal" aria-hidden="true">
                <span></span><span></span><span></span><span></span><span></span>
            </div>
        </section>
        <section class="auth-panel">
            <button
                type="button"
                class="icon-button absolute right-5 top-5"
                :aria-label="isDark ? '切换为浅色模式' : '切换为深色模式'"
                @click="emit('toggleTheme')">
                <IconSun v-if="isDark" :size="18" />
                <IconMoon v-else :size="18" />
            </button>
            <form class="auth-form" @submit.prevent="emit('pair')">
                <div>
                    <p class="eyebrow">DEVICE PAIRING</p>
                    <h2>授权此设备</h2>
                    <p class="mt-3 text-fg-secondary">
                        输入管理服务生成的一次性授权码，有效期为 5 分钟。
                    </p>
                </div>
                <div v-if="error" role="alert" class="feedback feedback-error">
                    <IconAlertTriangle :size="18" /><span>{{ error }}</span>
                </div>
                <label class="space-y-2" for="pair-code">
                    <span class="text-sm font-medium">一次性授权码</span>
                    <UiInput
                        id="pair-code"
                        v-model="code"
                        type="password"
                        autocomplete="off"
                        placeholder="输入设备码或恢复码" />
                </label>
                <UiButton type="submit" variant="primary" :loading="busy" :disabled="!code.trim()">
                    连接管理服务 <IconChevronRight :size="16" />
                </UiButton>
                <details class="auth-help">
                    <summary>如何获取授权码</summary>
                    <div class="space-y-4 pt-4">
                        <p>
                            <strong>首次安装</strong
                            ><code>onebots auth bootstrap --data-dir &lt;工作区&gt;</code>
                        </p>
                        <p>
                            <strong>添加设备</strong
                            ><code>onebots auth device --data-dir &lt;工作区&gt;</code>
                        </p>
                        <p>
                            <strong>恢复访问</strong
                            ><code>onebots auth recover --data-dir &lt;工作区&gt;</code>
                        </p>
                        <p class="text-xs text-fg-tertiary">
                            恢复访问会撤销所有旧设备。Docker 环境可通过 docker exec 运行命令。
                        </p>
                    </div>
                </details>
            </form>
        </section>
    </main>
</template>
