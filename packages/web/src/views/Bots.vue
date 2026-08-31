<template>
    <div class="h-full overflow-y-auto bg-bg">
        <div class="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 sm:py-6">
            <div class="mb-6 flex items-center justify-between gap-3 border-b border-border pb-4">
                <h2 class="flex items-center gap-2 text-xl font-semibold text-fg">
                    <IconRobot :size="22" stroke="1.5" class="text-fg-secondary" />
                    机器人管理
                </h2>
                <div class="flex items-center gap-2">
                    <UiBadge variant="neutral">共 {{ totalBotCount }} 个机器人</UiBadge>
                    <UiButton size="sm" @click="capabilitiesOpen = true">
                        <IconListCheck :size="14" />
                        <span class="hidden sm:inline">能力概览</span>
                    </UiButton>
                </div>
            </div>

            <UiEmpty
                v-if="totalBotCount === 0"
                title="暂无机器人"
                :description="onboarding.description">
                <div class="mt-2 flex flex-wrap justify-center gap-2">
                    <UiButton size="sm" @click="capabilitiesOpen = true">比较平台能力</UiButton>
                    <RouterLink v-slot="{ navigate }" custom :to="onboarding.route">
                        <UiButton size="sm" variant="primary" @click="navigate">
                            {{ onboarding.actionLabel }}
                        </UiButton>
                    </RouterLink>
                </div>
            </UiEmpty>
            <div
                v-else
                class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-4">
                <template v-for="adapter of adapters" :key="adapter.platform">
                    <BotCard
                        v-for="bot of adapter.accounts"
                        :key="`${bot.platform}:${bot.uin}`"
                        :bot="bot"
                        :adapter-icon="adapter.icon"
                        :loading="loadingBots.has(`${bot.platform}:${bot.uin}`)"
                        @start="handleBotStart"
                        @stop="handleBotStop" />
                </template>
            </div>
        </div>
        <AdapterCapabilitiesDrawer v-model="capabilitiesOpen" :adapters="capabilityAdapters" />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { IconListCheck, IconRobot } from "@tabler/icons-vue";
import UiBadge from "../ui/UiBadge.vue";
import UiButton from "../ui/UiButton.vue";
import UiEmpty from "../ui/UiEmpty.vue";
import { useToast } from "../ui/toast";
import { useApi } from "../composables/useApi";
import { authFetch } from "../composables/useAuth";
import { buildApiUrl } from "../config";
import { reportClientError } from "../client-diagnostics";
import BotCard from "../components/BotCard.vue";
import AdapterCapabilitiesDrawer from "../components/AdapterCapabilitiesDrawer.vue";
import type { AccountInfo, ExtensionInfo } from "../types";
import { mergeCapabilityAdapters } from "../components/capability-presentation.js";
import { getBotOnboardingState } from "./bot-onboarding.js";

const { adapters, totalBotCount, startBot, stopBot } = useApi();
const toast = useToast();

const loadingBots = ref<Set<string>>(new Set());
const capabilitiesOpen = ref(false);
const extensions = ref<ExtensionInfo[]>([]);
const capabilityAdapters = computed(() =>
    mergeCapabilityAdapters(adapters.value, extensions.value),
);
const onboarding = computed(() => getBotOnboardingState(adapters.value.length > 0));

onMounted(async () => {
    try {
        const response = await authFetch(buildApiUrl("/api/extensions"));
        if (!response.ok) throw new Error("无法读取适配器能力目录");
        extensions.value = await response.json();
    } catch (error) {
        reportClientError("获取适配器能力目录失败", error);
    }
});

const botKey = (bot: AccountInfo) => `${bot.platform}:${bot.uin}`;

const handleBotStart = async (bot: AccountInfo) => {
    const key = botKey(bot);
    loadingBots.value.add(key);
    try {
        const ok = await startBot(bot.platform, bot.uin);
        if (ok) {
            toast.success(`机器人 ${bot.uin} 已上线`);
        } else {
            toast.error(`启动机器人 ${bot.uin} 失败`);
        }
    } finally {
        loadingBots.value.delete(key);
    }
};

const handleBotStop = async (bot: AccountInfo) => {
    const key = botKey(bot);
    loadingBots.value.add(key);
    try {
        const ok = await stopBot(bot.platform, bot.uin);
        if (ok) {
            toast.warning(`机器人 ${bot.uin} 已下线`);
        } else {
            toast.error(`停止机器人 ${bot.uin} 失败`);
        }
    } finally {
        loadingBots.value.delete(key);
    }
};
</script>
