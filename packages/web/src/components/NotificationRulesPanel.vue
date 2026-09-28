<script setup lang="ts">
import { computed, ref } from "vue";
import { IconPlus, IconTrash } from "@tabler/icons-vue";
import {
    notificationEvents,
    type NotificationChannel,
    type NotificationConfig,
} from "../notification-model.js";
import UiButton from "../ui/UiButton.vue";
import UiInfoTip from "../ui/UiInfoTip.vue";

const props = defineProps<{ config: NotificationConfig; accounts: string[] }>();
const accountChoices = computed(() =>
    Array.from(
        new Set([
            ...props.accounts,
            ...props.config.rules.flatMap(rule => (rule.accounts === "all" ? [] : rule.accounts)),
        ]),
    ).sort(),
);
const openRuleId = ref<string>();
function addRule() {
    const id = crypto.randomUUID();
    props.config.rules.push({
        id,
        name: "新规则",
        enabled: true,
        events: ["gateway.failed", "account.offline", "login.interaction"],
        accounts: "all",
        channelIds: [],
    });
    openRuleId.value = id;
}
function toggle<T>(items: T[], value: T, checked: boolean) {
    const index = items.indexOf(value);
    if (checked && index < 0) items.push(value);
    if (!checked && index >= 0) items.splice(index, 1);
}
function kind(channel: NotificationChannel) {
    return { webhook: "Webhook", email: "邮件", bark: "Bark" }[channel.type];
}
</script>

<template>
    <div class="notification-stack">
        <div v-if="config.rules.length" class="notification-row">
            <span
                >事件规则
                <UiInfoTip
                    label="规则说明"
                    text="按事件和账号选择目标渠道；多个规则命中同一渠道时只投递一次。"
            /></span>
            <UiButton variant="ghost" @click="addRule"><IconPlus :size="16" /> 添加规则</UiButton>
        </div>
        <div v-else class="notification-empty-state">
            <h3>还没有通知规则</h3>
            <p>添加规则后，选择需要提醒的事件和投递渠道。</p>
            <UiButton variant="primary" @click="addRule"
                ><IconPlus :size="16" aria-hidden="true" /> 添加规则</UiButton
            >
        </div>
        <details
            v-for="(rule, index) in config.rules"
            :key="rule.id"
            class="notification-card notification-rule"
            :open="openRuleId === rule.id"
            @toggle="
                openRuleId = ($event.target as HTMLDetailsElement).open
                    ? rule.id
                    : openRuleId === rule.id
                      ? undefined
                      : openRuleId
            ">
            <summary>
                {{ rule.name }}
                <span
                    >{{ rule.enabled ? "启用" : "暂停" }} · {{ rule.events.length }} 类事件 ·
                    {{ rule.channelIds.length }} 个渠道</span
                >
            </summary>
            <div class="notification-rule-fields">
                <div class="notification-row">
                    <label class="notification-field"
                        >规则名称<input v-model.trim="rule.name"
                    /></label>
                    <label class="notification-check"
                        ><input v-model="rule.enabled" type="checkbox" /> 启用</label
                    >
                </div>
                <h3>触发事件</h3>
                <div class="notification-options">
                    <label
                        v-for="event in notificationEvents"
                        :key="event.id"
                        class="notification-check">
                        <input
                            type="checkbox"
                            :checked="rule.events.includes(event.id)"
                            @change="
                                toggle(
                                    rule.events,
                                    event.id,
                                    ($event.target as HTMLInputElement).checked,
                                )
                            " />
                        {{ event.label }}</label
                    >
                </div>
                <h3>账号范围</h3>
                <label class="notification-check"
                    ><input
                        type="radio"
                        :name="`notification-account-scope-${rule.id}`"
                        :checked="rule.accounts === 'all'"
                        @change="rule.accounts = 'all'" />
                    全部账号（包含后续新增）</label
                >
                <label class="notification-check"
                    ><input
                        type="radio"
                        :name="`notification-account-scope-${rule.id}`"
                        :checked="rule.accounts !== 'all'"
                        @change="rule.accounts = []" />
                    指定账号</label
                >
                <div v-if="rule.accounts !== 'all'" class="notification-options">
                    <label
                        v-for="account in accountChoices"
                        :key="account"
                        class="notification-check"
                        ><input
                            type="checkbox"
                            :checked="rule.accounts.includes(account)"
                            @change="
                                toggle(
                                    rule.accounts as string[],
                                    account,
                                    ($event.target as HTMLInputElement).checked,
                                )
                            " />
                        {{ account }}</label
                    >
                    <p v-if="!accountChoices.length" class="notification-help">
                        暂无账号。启动网关后可选择；也可使用“全部账号”。
                    </p>
                </div>
                <h3>目标渠道</h3>
                <div class="notification-options">
                    <label
                        v-for="channel in config.channels"
                        :key="channel.id"
                        class="notification-check"
                        ><input
                            type="checkbox"
                            :checked="rule.channelIds.includes(channel.id)"
                            @change="
                                toggle(
                                    rule.channelIds,
                                    channel.id,
                                    ($event.target as HTMLInputElement).checked,
                                )
                            " />
                        {{ channel.name }}（{{ kind(channel) }}）</label
                    >
                </div>
                <UiButton variant="danger" @click="config.rules.splice(index, 1)"
                    ><IconTrash :size="16" /> 删除规则</UiButton
                >
            </div>
        </details>
    </div>
</template>
