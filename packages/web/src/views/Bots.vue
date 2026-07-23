<template>
    <div class="h-full overflow-y-auto bg-bg">
        <div class="mx-auto max-w-[1400px] px-6 py-6">
            <div class="mb-6 flex items-center justify-between border-b border-border pb-4">
                <h2 class="flex items-center gap-2 text-xl font-semibold text-fg">
                    <IconRobot :size="22" :stroke="1.5" class="text-fg-secondary" />
                    机器人管理
                </h2>
                <UiBadge variant="neutral">共 {{ totalBotCount }} 个机器人</UiBadge>
            </div>

            <UiEmpty v-if="adapters.length === 0" title="暂无机器人" />
            <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
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
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { IconRobot } from '@tabler/icons-vue';
import UiBadge from '../ui/UiBadge.vue';
import UiEmpty from '../ui/UiEmpty.vue';
import { useToast } from '../ui/toast';
import { useApi } from '../composables/useApi';
import BotCard from '../components/BotCard.vue';
import type { AccountInfo } from '../types';

const { adapters, totalBotCount, startBot, stopBot } = useApi();
const toast = useToast();

const loadingBots = ref<Set<string>>(new Set());

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
