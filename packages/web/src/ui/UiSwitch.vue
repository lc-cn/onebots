<script setup lang="ts">
interface Props {
    disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    disabled: false
});

const model = defineModel<boolean>({ default: false });

function toggle() {
    if (props.disabled) return;
    model.value = !model.value;
}
</script>

<template>
    <button
        type="button"
        role="switch"
        :aria-checked="model"
        :disabled="disabled"
        class="relative h-5 w-9 shrink-0 rounded-full focus:shadow-[0_0_0_3px_var(--ring)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        :class="model ? 'bg-accent' : 'bg-border-strong'"
        @click="toggle">
        <span
            class="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
            :class="model ? 'translate-x-4' : 'translate-x-0'" />
    </button>
</template>
