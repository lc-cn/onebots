<script setup lang="ts">
import { IconCheck } from "@tabler/icons-vue";

interface StepItem {
    key: string;
    label: string;
}

const props = withDefaults(
    defineProps<{
        steps: StepItem[];
        /** 当前步骤索引（从 0 开始） */
        current: number;
        /** 是否允许点击步骤跳转（编辑模式用） */
        clickable?: boolean;
    }>(),
    { clickable: false },
);

const emit = defineEmits<{
    select: [index: number];
}>();

function onSelect(index: number) {
    if (!props.clickable) return;
    emit("select", index);
}
</script>

<template>
    <ol class="flex items-center" role="list">
        <template v-for="(step, index) in steps" :key="step.key">
            <!-- 连接线 -->
            <div
                v-if="index > 0"
                class="mx-2 h-px min-w-4 flex-1 transition-colors"
                :class="index <= current ? 'bg-accent' : 'bg-border'"
                aria-hidden="true"></div>
            <li>
                <button
                    type="button"
                    class="flex items-center gap-2 rounded-control px-1 py-0.5"
                    :class="[
                        clickable ? 'cursor-pointer' : 'cursor-default',
                        index === current ? '' : '',
                    ]"
                    :disabled="!clickable"
                    :aria-current="index === current ? 'step' : undefined"
                    @click="onSelect(index)">
                    <span
                        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors"
                        :class="
                            index < current
                                ? 'bg-accent text-accent-fg'
                                : index === current
                                  ? 'border-2 border-accent text-accent'
                                  : 'border border-border-strong text-fg-tertiary'
                        ">
                        <IconCheck
                            v-if="index < current"
                            :size="13"
                            stroke="2.5"
                            aria-hidden="true" />
                        <template v-else>{{ index + 1 }}</template>
                    </span>
                    <span
                        class="text-xs whitespace-nowrap transition-colors sm:text-sm"
                        :class="
                            index === current
                                ? 'font-medium text-fg'
                                : index < current
                                  ? 'text-fg-secondary'
                                  : 'text-fg-tertiary'
                        ">
                        {{ step.label }}
                    </span>
                </button>
            </li>
        </template>
    </ol>
</template>
