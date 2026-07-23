<script setup lang="ts">
import { computed, ref, watch, nextTick, onUnmounted } from "vue";
import { IconX } from "@tabler/icons-vue";

interface Props {
    title?: string;
    placement?: "bottom" | "right";
    /** bottom 时为高度，right 时为宽度 */
    size?: string;
}

const props = withDefaults(defineProps<Props>(), {
    placement: "right",
});

const visible = defineModel<boolean>({ default: false });

const panelRef = ref<HTMLElement | null>(null);
let lastFocused: HTMLElement | null = null;
let scrollLocked = false;

const panelClass = computed(() => {
    if (props.placement === "bottom") {
        return "inset-x-0 bottom-0 max-h-[85vh] rounded-t-card";
    }
    return "inset-y-0 right-0 h-full";
});

const panelStyle = computed(() => {
    if (props.placement === "bottom") {
        return { height: props.size ?? "45vh" };
    }
    return { width: props.size ?? "400px", maxWidth: "calc(100vw - 2rem)" };
});

const slideFrom = computed(() =>
    props.placement === "bottom" ? "translate-y-full" : "translate-x-full",
);

function lockScroll() {
    if (scrollLocked) return;
    document.body.style.overflow = "hidden";
    scrollLocked = true;
}

function unlockScroll() {
    if (!scrollLocked) return;
    document.body.style.overflow = "";
    scrollLocked = false;
}

function close() {
    visible.value = false;
}

function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
        event.stopPropagation();
        close();
    }
}

watch(visible, async value => {
    if (value) {
        lastFocused = document.activeElement as HTMLElement | null;
        lockScroll();
        await nextTick();
        panelRef.value?.focus();
        document.addEventListener("keydown", onKeydown);
    } else {
        unlockScroll();
        document.removeEventListener("keydown", onKeydown);
        lastFocused?.focus();
        lastFocused = null;
    }
});

onUnmounted(() => {
    unlockScroll();
    document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
    <Teleport to="body">
        <Transition
            enter-active-class="transition-opacity duration-150 ease-out"
            enter-from-class="opacity-0"
            enter-to-class="opacity-100"
            leave-active-class="transition-opacity duration-150 ease-in"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0">
            <div
                v-if="visible"
                class="fixed inset-0 z-[90] bg-black/50"
                aria-hidden="true"
                @click="close"></div>
        </Transition>
        <Transition
            enter-active-class="transition-transform duration-200 ease-out"
            :enter-from-class="slideFrom"
            enter-to-class="translate-x-0 translate-y-0"
            leave-active-class="transition-transform duration-200 ease-in"
            leave-from-class="translate-x-0 translate-y-0"
            :leave-to-class="slideFrom">
            <div
                v-if="visible"
                ref="panelRef"
                role="dialog"
                aria-modal="true"
                tabindex="-1"
                class="fixed z-[91] flex flex-col border border-border bg-surface shadow-xl focus:outline-none"
                :class="panelClass"
                :style="panelStyle">
                <div v-if="props.placement === 'bottom'" class="flex justify-center pt-2">
                    <div class="h-1 w-10 rounded-full bg-border-strong"></div>
                </div>
                <div class="flex items-center justify-between border-b border-border px-4 py-3">
                    <h2 class="truncate text-base font-medium text-fg">{{ props.title }}</h2>
                    <button
                        type="button"
                        aria-label="关闭"
                        class="rounded-control p-1 text-fg-tertiary transition-colors hover:bg-surface-raised hover:text-fg"
                        @click="close">
                        <IconX :size="18" />
                    </button>
                </div>
                <div class="flex-1 overflow-y-auto p-4">
                    <slot />
                </div>
            </div>
        </Transition>
    </Teleport>
</template>
