<template>
    <div class="inline-block">
        <img
            v-if="dataUrl"
            :src="dataUrl"
            :alt="alt ?? '二维码'"
            :width="size"
            :height="size"
            class="block rounded border border-border bg-white p-2" />
        <div
            v-else
            class="flex items-center justify-center rounded border border-border bg-surface-raised text-fg-tertiary"
            :style="{ width: `${size}px`, height: `${size}px` }">
            <UiSpinner v-if="!failed" :size="20" />
            <span v-else class="px-3 text-center text-xs">二维码生成失败</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import QRCode from 'qrcode';
import UiSpinner from '../ui/UiSpinner.vue';

const props = withDefaults(
    defineProps<{
        /** 二维码编码内容（如登录 URL） */
        content: string;
        alt?: string;
        size?: number;
    }>(),
    { size: 220 }
);

const dataUrl = ref('');
const failed = ref(false);

async function render() {
    dataUrl.value = '';
    failed.value = false;
    try {
        dataUrl.value = await QRCode.toDataURL(props.content, {
            margin: 1,
            width: props.size,
            errorCorrectionLevel: 'M',
        });
    } catch (error) {
        console.error('生成二维码失败:', error);
        failed.value = true;
    }
}

onMounted(render);
watch(() => props.content, render);
</script>
