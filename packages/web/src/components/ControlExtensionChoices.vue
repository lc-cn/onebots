<script setup lang="ts">
import type { ControlInstallationCatalog } from "@onebots/core/control";
defineProps<{
    label: string;
    entries: ControlInstallationCatalog["protocols"] | ControlInstallationCatalog["applications"];
    installed: string[];
    disabled: boolean;
}>();
const selected = defineModel<string[]>({ required: true });
</script>
<template>
    <div class="extension-secondary-sections">
        <section class="extension-choice-group border border-border rounded-panel p-4 bg-surface">
            <h2>
                {{ label }}
                <span>{{ selected.length }} 项已选</span>
            </h2>
            <fieldset :disabled="disabled" class="extension-choice-cards">
                <label
                    v-for="entry in entries"
                    :key="entry.name"
                    class="extension-choice-card"
                    :class="{
                        selected: selected.includes(entry.name),
                    }">
                    <input
                        v-model="selected"
                        type="checkbox"
                        :value="entry.name"
                        class="mt-1 accent-accent" />
                    <span class="extension-choice-copy">
                        <strong>{{ entry.displayName }}</strong>
                        <small>{{ entry.name }}</small>
                        <small v-if="'version' in entry"
                            >{{ installed.includes(entry.name) ? "当前安装版本" : "目录版本" }} v{{
                                entry.version
                            }}</small
                        >
                        <small v-else>内置支持，无独立版本</small>
                    </span>
                    <em>{{
                        installed.includes(entry.name)
                            ? "已安装"
                            : selected.includes(entry.name)
                              ? "待安装"
                              : "未安装"
                    }}</em>
                </label>
                <p v-if="!entries.length" class="text-sm text-fg-muted">暂无可选项</p>
            </fieldset>
            <p
                v-if="selected.some(name => !entries.some(entry => entry.name === name))"
                class="text-xs text-danger mt-3">
                当前集合含目录外扩展，已保留选择；请先由管理员核查。
            </p>
        </section>
    </div>
</template>
