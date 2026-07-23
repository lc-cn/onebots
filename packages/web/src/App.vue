<template>
    <router-view />
    <ToastHost />
    <ConfirmHost />
</template>

<script setup lang="ts">
import ToastHost from './ui/ToastHost.vue';
import ConfirmHost from './ui/ConfirmHost.vue';
</script>
