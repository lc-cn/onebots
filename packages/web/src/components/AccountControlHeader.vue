<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { IconArrowLeft } from "@tabler/icons-vue";
import { accountImageUrl, type AccountConnectionCard } from "../account-overview.js";

const props = defineProps<{
    account?: AccountConnectionCard;
    platform: string;
    accountId: string;
    connectionState: "online" | "offline" | "unknown";
}>();
const emit = defineEmits<{ back: [] }>();
const failedImages = ref(new Set<string>());
const avatar = computed(() => props.account && accountImageUrl(props.account, failedImages.value));

watch(
    () => [props.platform, props.accountId],
    () => {
        failedImages.value = new Set();
    },
);

function failAvatar() {
    if (avatar.value) failedImages.value = new Set([...failedImages.value, avatar.value]);
}
</script>

<template>
    <header class="account-control-header">
        <button type="button" class="account-control-back" @click="emit('back')">
            <IconArrowLeft :size="19" aria-hidden="true" /> 返回账号
        </button>
        <div class="account-control-identity">
            <span class="account-logo" aria-hidden="true">
                <img
                    v-if="avatar"
                    :src="avatar"
                    alt=""
                    width="52"
                    height="52"
                    referrerpolicy="no-referrer"
                    @error="failAvatar" />
                <span v-else>{{ platform.slice(0, 2).toUpperCase() }}</span>
            </span>
            <div>
                <p>{{ account?.platformLabel ?? platform }}</p>
                <h1 id="account-control-title">{{ accountId }}</h1>
            </div>
        </div>
        <span class="account-status" :class="connectionState">{{
            connectionState === "unknown"
                ? "状态待确认"
                : connectionState === "online"
                  ? "在线"
                  : "已离线"
        }}</span>
    </header>
</template>
