<script setup lang="ts">
import { useAttrs } from "vue";

defineOptions({ inheritAttrs: false });
interface Props {
    rows?: number;
    placeholder?: string;
    disabled?: boolean;
    mono?: boolean;
    error?: string;
}

withDefaults(defineProps<Props>(), {
    rows: 4,
    placeholder: "",
    disabled: false,
    mono: false,
    error: "",
});

const model = defineModel<string>({ default: "" });
const attrs = useAttrs();
</script>

<template>
    <textarea
        v-bind="attrs"
        v-model="model"
        :rows="rows"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-invalid="!!error || undefined"
        class="ui-textarea w-full resize-y rounded-control border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-tertiary transition-opacity focus-visible:shadow-[0_0_0_3px_var(--ring)] disabled:cursor-not-allowed disabled:opacity-50"
        :class="[
            error
                ? 'border-danger focus-visible:border-danger'
                : 'border-border focus-visible:border-accent',
            mono ? 'font-mono text-[13px]' : '',
        ]" />
</template>
