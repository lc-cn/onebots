<script setup lang="ts">
import { ref, toRef, watch } from "vue";
import type { ControlAccountItem } from "@onebots/core/control";
import { useAccountRetryFocus } from "../use-account-retry-focus.js";
import UiButton from "../ui/UiButton.vue";

const props = defineProps<{
    selected: ControlAccountItem;
    activeItem?: ControlAccountItem;
    members: ControlAccountItem[];
    membersSupported: boolean;
    membersTruncated: boolean;
    memberLoading: boolean;
    memberError: string;
    detailError: string;
    detailSupported?: boolean;
    detailLoading: boolean;
}>();
const emit = defineEmits<{ retryMembers: []; retryDetail: [] }>();
const detailResult = ref<HTMLElement>();
const membersResult = ref<HTMLElement>();
const detailRetry = useAccountRetryFocus(
    toRef(props, "detailError"),
    toRef(props, "detailLoading"),
    detailResult,
);
const membersRetry = useAccountRetryFocus(
    toRef(props, "memberError"),
    toRef(props, "memberLoading"),
    membersResult,
);

function retryDetail() {
    detailRetry.begin();
    emit("retryDetail");
}

function retryMembers() {
    membersRetry.begin();
    emit("retryMembers");
}

watch(
    () => props.selected,
    () => {
        detailRetry.reset();
        membersRetry.reset();
    },
);
</script>

<template>
    <aside
        class="account-control-context"
        :class="{ 'single-section': selected.kind === 'friend' }"
        aria-label="会话详情">
        <section>
            <h2>详情</h2>
            <div v-if="activeItem" class="account-control-detail">
                <strong ref="detailResult" tabindex="-1">{{ activeItem.name }}</strong
                ><small>{{ activeItem.id }}</small>
                <p v-if="activeItem.subtitle">{{ activeItem.subtitle }}</p>
                <p v-if="activeItem.memberCount !== undefined">
                    {{ activeItem.memberCount }} 位成员
                </p>
            </div>
            <p v-else class="account-control-hint">选择会话后显示对象信息。</p>
            <p v-if="detailSupported === false" class="account-control-hint">
                此平台暂不提供详细资料，以上为列表中的基本信息。
            </p>
            <div v-if="detailError" class="account-control-error" role="alert">
                <p>{{ detailError }}</p>
                <UiButton size="sm" :disabled="detailLoading" @click="retryDetail">
                    重试读取
                </UiButton>
            </div>
        </section>
        <section v-if="selected.kind !== 'friend'">
            <h2 ref="membersResult" tabindex="-1">成员</h2>
            <p v-if="memberLoading" class="account-control-hint">正在读取成员…</p>
            <div v-else-if="memberError" class="account-control-error" role="alert">
                <p>{{ memberError }}</p>
                <UiButton size="sm" :disabled="memberLoading" @click="retryMembers">
                    重试读取
                </UiButton>
            </div>
            <p v-else-if="!membersSupported" class="account-control-hint">
                此平台暂不提供成员列表。
            </p>
            <p v-else-if="!members.length" class="account-control-hint">暂无可展示的成员。</p>
            <ul v-else class="account-control-members">
                <li v-for="member in members" :key="member.id">
                    <span>{{ member.name }}</span
                    ><small>{{ member.role ?? member.id }}</small>
                </li>
            </ul>
            <p v-if="membersTruncated && !memberError" class="account-control-hint">
                成员较多，目前只展示前 500 位。
            </p>
        </section>
    </aside>
</template>
