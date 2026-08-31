<script setup lang="ts">
interface Props {
    rows?: number;
    placeholder?: string;
    disabled?: boolean;
    mono?: boolean;
    error?: string;
}

withDefaults(defineProps<Props>(), {
    rows: 4,
    placeholder: '',
    disabled: false,
    mono: false,
    error: ''
});

const model = defineModel<string>({ default: '' });
</script>

<template>
    <textarea
        v-model="model"
        :rows="rows"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-invalid="!!error || undefined"
        class="w-full resize-y rounded-control border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-tertiary transition-opacity focus:shadow-[0_0_0_3px_var(--ring)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        :class="[
            error ? 'border-danger focus:border-danger' : 'border-border focus:border-accent',
            mono ? 'font-mono text-[13px]' : ''
        ]" />
</template>
