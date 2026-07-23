<script setup lang='ts'>
import { computed, ref } from 'vue';

interface Props {
    /** 图片地址 */
    src?: string;
    /** 名称（无图时取首字符） */
    name?: string;
    /** 尺寸（像素） */
    size?: number;
}

const props = withDefaults(defineProps<Props>(), {
    src: undefined,
    name: '',
    size: 40,
});

const loadFailed = ref(false);

const showImage = computed(() => Boolean(props.src) && !loadFailed.value);
const initial = computed(() => (props.name?.trim().charAt(0) || '?').toUpperCase());
const sizeStyle = computed(() => ({
    width: `${props.size}px`,
    height: `${props.size}px`,
    fontSize: `${Math.round(props.size * 0.4)}px`,
}));
</script>

<template>
    <span
        class="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-raised font-medium text-fg-secondary select-none"
        :style="sizeStyle">
        <img
            v-if="showImage"
            :src="src"
            :alt="name || '头像'"
            class="size-full object-cover"
            @error="loadFailed = true" />
        <span v-else aria-hidden="true">{{ initial }}</span>
    </span>
</template>
