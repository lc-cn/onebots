<script setup lang="ts">
import { useAttrs } from "vue";

defineOptions({ inheritAttrs: false });
interface Props {
    disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    disabled: false,
});

const model = defineModel<boolean>({ default: false });
const attrs = useAttrs();

function toggle() {
    if (props.disabled) return;
    model.value = !model.value;
}
</script>

<template>
    <button
        v-bind="attrs"
        type="button"
        role="switch"
        :aria-checked="model"
        :disabled="disabled"
        class="relative h-6 w-11 shrink-0 rounded-full focus-visible:shadow-[0_0_0_3px_var(--ring)] disabled:cursor-not-allowed disabled:opacity-50"
        :class="model ? 'bg-accent' : 'bg-border-strong'"
        @click="toggle">
        <span
            aria-hidden="true"
            class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
            :class="model ? 'translate-x-5' : 'translate-x-0'" />
    </button>
</template>
