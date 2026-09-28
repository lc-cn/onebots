<script setup lang="ts">
import { computed, ref } from "vue";
import {
    IconAlertTriangle,
    IconChevronRight,
    IconCopy,
    IconMoon,
    IconSun,
} from "@tabler/icons-vue";
import UiButton from "../ui/UiButton.vue";
import UiInput from "../ui/UiInput.vue";

defineProps<{ busy: boolean; error: string; isDark: boolean }>();
const code = defineModel<string>({ required: true });
const emit = defineEmits<{ pair: []; toggleTheme: [] }>();
const environment = ref<"local" | "docker">("local");
const authorization = ref<"bootstrap" | "device">("bootstrap");
const copyState = ref("");
const command = computed(() =>
    environment.value === "docker"
        ? `docker exec onebots onebots auth ${authorization.value} --data-dir /data`
        : `onebots auth ${authorization.value} --data-dir <数据目录>`,
);

async function copyCommand() {
    try {
        await navigator.clipboard.writeText(command.value);
        copyState.value = "已复制；本机安装时请把 <数据目录> 换成实际路径。";
    } catch {
        copyState.value = "复制失败，请选中命令后手动复制。";
    }
}
</script>

<template>
    <main class="auth-shell">
        <section class="auth-story" aria-labelledby="auth-title">
            <div class="brand-lockup">
                <span class="brand-mark" aria-hidden="true">OB</span>
                <span>onebots <small>control</small></span>
            </div>
            <div class="auth-story-copy">
                <p class="auth-context">本地部署 · 设备授权</p>
                <h1 id="auth-title">运行你的<br />消息网关</h1>
                <p>在一个本地控制面中管理平台账号、协议出口与网关生命周期。</p>
            </div>
            <div class="auth-principles" aria-label="产品特性">
                <div>
                    <span>01</span>
                    <p><strong>数据留在本地</strong><small>配置与凭据保存在你的工作区</small></p>
                </div>
                <div>
                    <span>02</span>
                    <p><strong>设备独立授权</strong><small>每个管理会话均可单独撤销</small></p>
                </div>
                <div>
                    <span>03</span>
                    <p><strong>网关独立运行</strong><small>停止网关不影响管理服务</small></p>
                </div>
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
                    <div class="auth-step"><span>设备授权</span><span>01 / 01</span></div>
                    <h2>连接你的管理台</h2>
                    <p class="mt-3 text-fg-secondary">
                        先在运行 OneBots 的电脑或服务器上获取一次性设备码，再填到下方。
                    </p>
                </div>
                <div class="pairing-guide">
                    <strong>① 获取设备码</strong>
                    <div class="pairing-environments" role="group" aria-label="授权场景">
                        <button
                            type="button"
                            :aria-pressed="authorization === 'bootstrap'"
                            @click="authorization = 'bootstrap'">
                            首次使用
                        </button>
                        <button
                            type="button"
                            :aria-pressed="authorization === 'device'"
                            @click="authorization = 'device'">
                            给新设备授权
                        </button>
                    </div>
                    <div class="pairing-environments" role="group" aria-label="安装方式">
                        <button
                            type="button"
                            :aria-pressed="environment === 'local'"
                            @click="environment = 'local'">
                            本机或服务器安装
                        </button>
                        <button
                            type="button"
                            :aria-pressed="environment === 'docker'"
                            @click="environment = 'docker'">
                            Docker
                        </button>
                    </div>
                    <p v-if="environment === 'docker'">
                        在运行容器的电脑上打开终端。容器名不是
                        <code>onebots</code> 时，请替换为实际名称。
                    </p>
                    <p v-else>
                        在运行 OneBots 的电脑或服务器上打开终端；数据目录是启动服务时指定的工作区。
                    </p>
                    <p v-if="authorization === 'device'">
                        已有管理台时，使用这条命令授权当前浏览器；不会使其他设备退出。
                    </p>
                    <div class="pairing-command">
                        <code>{{ command }}</code
                        ><button type="button" aria-label="复制获取设备码命令" @click="copyCommand">
                            <IconCopy :size="16" />复制
                        </button>
                    </div>
                    <p v-if="copyState" role="status">{{ copyState }}</p>
                    <a
                        href="https://onebots.pages.dev/guide/management-login"
                        target="_blank"
                        rel="noopener noreferrer"
                        >找不到数据目录？查看按安装方式获取设备码的说明</a
                    >
                </div>
                <div v-if="error" role="alert" class="feedback feedback-error">
                    <IconAlertTriangle :size="18" /><span>{{ error }}</span>
                </div>
                <label class="space-y-2" for="pair-code">
                    <span class="text-sm font-medium">② 输入设备码</span>
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
                <p class="auth-expiry">授权码 5 分钟后失效 · 不会挤掉已有设备</p>
                <details class="auth-help">
                    <summary>已经授权过，或需要找回访问？</summary>
                    <div class="space-y-4 pt-4">
                        <p>
                            <strong>授权新设备（保留已有设备）</strong
                            ><code>onebots auth device --data-dir &lt;工作区&gt;</code>
                        </p>
                        <p>
                            <strong>恢复访问（兑换后撤销旧设备）</strong
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
