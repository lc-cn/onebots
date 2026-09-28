<script setup lang="ts">
import { IconPlus, IconTrash } from "@tabler/icons-vue";
import {
    addChannel,
    type NotificationChannel,
    type NotificationConfig,
} from "../notification-model.js";
import UiButton from "../ui/UiButton.vue";
import UiInfoTip from "../ui/UiInfoTip.vue";

const props = defineProps<{ config: NotificationConfig; busy: boolean; dirty: boolean }>();
const emit = defineEmits<{ test: [id: string] }>();
function uuid() {
    return crypto.randomUUID();
}
function kind(channel: NotificationChannel) {
    return { webhook: "Webhook", email: "邮件", bark: "Bark" }[channel.type];
}
function setWebhookAuth(channel: Extract<NotificationChannel, { type: "webhook" }>, mode: string) {
    if (mode === "none") channel.auth = { type: "none" };
    else if (mode === "bearer" || mode === "hmac")
        channel.auth = {
            type: mode,
            secret: channel.auth.type === mode ? channel.auth.secret : "",
        };
}
function removeChannel(id: string) {
    props.config.channels = props.config.channels.filter(item => item.id !== id);
    for (const rule of props.config.rules)
        rule.channelIds = rule.channelIds.filter(item => item !== id);
}
</script>

<template>
    <div class="notification-stack">
        <div class="notification-card">
            <h2>
                管理台入口
                <UiInfoTip
                    label="管理台入口说明"
                    text="通知点击后打开受保护的登录挑战页。启用 Bark 登录通知前必须填写 HTTPS 外部访问 URL。" />
            </h2>
            <label class="notification-field"
                >外部访问 URL
                <input
                    v-model.trim="config.externalUrl"
                    type="url"
                    placeholder="https://onebots.example.com"
                    autocomplete="url" />
            </label>
        </div>

        <div class="notification-card">
            <div class="notification-row">
                <div>
                    <h2>
                        SMTP 发件配置
                        <UiInfoTip label="SMTP 配置说明" text="多个收件组可复用同一发件配置。" />
                    </h2>
                </div>
                <UiButton
                    variant="ghost"
                    @click="
                        config.smtpProfiles.push({
                            id: uuid(),
                            name: '新发件配置',
                            host: '',
                            port: 587,
                            secure: false,
                            username: '',
                            password: '',
                            from: '',
                        })
                    "
                    ><IconPlus :size="16" /> 添加</UiButton
                >
            </div>
            <details
                v-for="profile in config.smtpProfiles"
                :key="profile.id"
                class="notification-item">
                <summary>
                    {{ profile.name }} <span>{{ profile.host || "未设置服务器" }}</span>
                </summary>
                <div class="notification-grid">
                    <label class="notification-field"
                        >名称<input v-model.trim="profile.name"
                    /></label>
                    <label class="notification-field"
                        >SMTP 主机<input v-model.trim="profile.host" autocomplete="off"
                    /></label>
                    <label class="notification-field"
                        >端口<input v-model.number="profile.port" type="number" min="1" max="65535"
                    /></label>
                    <label class="notification-field"
                        >发件地址<input v-model.trim="profile.from" type="email"
                    /></label>
                    <label class="notification-field"
                        >用户名<input v-model="profile.username" autocomplete="off"
                    /></label>
                    <label class="notification-field"
                        >密码<input
                            v-model="profile.password"
                            type="password"
                            autocomplete="new-password"
                    /></label>
                </div>
                <label class="notification-check"
                    ><input v-model="profile.secure" type="checkbox" /> 使用隐式 TLS（通常端口
                    465）</label
                >
                <UiButton
                    variant="danger"
                    :disabled="
                        config.channels.some(
                            item => item.type === 'email' && item.smtpId === profile.id,
                        )
                    "
                    @click="
                        config.smtpProfiles = config.smtpProfiles.filter(
                            item => item.id !== profile.id,
                        )
                    "
                    ><IconTrash :size="16" /> 删除</UiButton
                >
            </details>
        </div>

        <div class="notification-card">
            <div class="notification-row">
                <div>
                    <h2>
                        邮件收件组
                        <UiInfoTip label="收件组说明" text="每行一个邮箱，可供多个邮件渠道选择。" />
                    </h2>
                </div>
                <UiButton
                    variant="ghost"
                    @click="
                        config.recipientGroups.push({
                            id: uuid(),
                            name: '新收件组',
                            addresses: [''],
                        })
                    "
                    ><IconPlus :size="16" /> 添加</UiButton
                >
            </div>
            <details
                v-for="group in config.recipientGroups"
                :key="group.id"
                class="notification-item">
                <summary>
                    {{ group.name }} <span>{{ group.addresses.length }} 个地址</span>
                </summary>
                <label class="notification-field">名称<input v-model.trim="group.name" /></label>
                <div
                    v-for="(_address, index) in group.addresses"
                    :key="index"
                    class="notification-row">
                    <input
                        v-model.trim="group.addresses[index]"
                        type="email"
                        aria-label="收件邮箱" />
                    <UiButton variant="ghost" @click="group.addresses.splice(index, 1)"
                        >移除</UiButton
                    >
                </div>
                <div class="notification-row">
                    <UiButton variant="ghost" @click="group.addresses.push('')">添加地址</UiButton>
                    <UiButton
                        variant="danger"
                        :disabled="
                            config.channels.some(
                                item => item.type === 'email' && item.groupId === group.id,
                            )
                        "
                        @click="
                            config.recipientGroups = config.recipientGroups.filter(
                                item => item.id !== group.id,
                            )
                        "
                        >删除收件组</UiButton
                    >
                </div>
            </details>
        </div>

        <div class="notification-card">
            <div class="notification-row">
                <div>
                    <h2>
                        投递渠道
                        <UiInfoTip label="渠道说明" text="渠道可暂停；规则决定事件发往哪些渠道。" />
                    </h2>
                </div>
                <div class="notification-actions">
                    <UiButton variant="ghost" @click="config.channels.push(addChannel('webhook'))"
                        >+ Webhook</UiButton
                    >
                    <UiButton variant="ghost" @click="config.channels.push(addChannel('email'))"
                        >+ 邮件</UiButton
                    >
                    <UiButton variant="ghost" @click="config.channels.push(addChannel('bark'))"
                        >+ Bark</UiButton
                    >
                </div>
            </div>
            <details v-for="channel in config.channels" :key="channel.id" class="notification-item">
                <summary>
                    {{ channel.name }}
                    <span>{{ kind(channel) }} · {{ channel.enabled ? "启用" : "暂停" }}</span>
                </summary>
                <div class="notification-grid">
                    <label class="notification-field"
                        >渠道名称<input v-model.trim="channel.name"
                    /></label>
                    <label class="notification-check"
                        ><input v-model="channel.enabled" type="checkbox" /> 启用渠道</label
                    >
                </div>
                <template v-if="channel.type === 'webhook'">
                    <label class="notification-field"
                        >目标 URL<input
                            v-model.trim="channel.url"
                            type="url"
                            placeholder="https://example.com/events"
                    /></label>
                    <label class="notification-field"
                        >认证方式<select
                            :value="channel.auth.type"
                            @change="
                                setWebhookAuth(channel, ($event.target as HTMLSelectElement).value)
                            ">
                            <option value="none">无</option>
                            <option value="bearer">Bearer Token</option>
                            <option value="hmac">HMAC-SHA256 签名</option>
                        </select></label
                    >
                    <label v-if="channel.auth.type !== 'none'" class="notification-field"
                        >密钥<input
                            v-model="channel.auth.secret"
                            type="password"
                            autocomplete="new-password"
                    /></label>
                    <label class="notification-check"
                        ><input v-model="channel.allowPrivateNetwork" type="checkbox" />
                        允许内网或本机 HTTP 目标</label
                    >
                </template>
                <template v-else-if="channel.type === 'email'">
                    <label class="notification-field"
                        >SMTP 发件配置<select v-model="channel.smtpId">
                            <option value="">请选择</option>
                            <option
                                v-for="profile in config.smtpProfiles"
                                :key="profile.id"
                                :value="profile.id">
                                {{ profile.name }}
                            </option>
                        </select></label
                    >
                    <label class="notification-field"
                        >收件组<select v-model="channel.groupId">
                            <option value="">请选择</option>
                            <option
                                v-for="group in config.recipientGroups"
                                :key="group.id"
                                :value="group.id">
                                {{ group.name }}
                            </option>
                        </select></label
                    >
                </template>
                <template v-else>
                    <label class="notification-field"
                        >Bark 服务地址<input
                            v-model.trim="channel.serverUrl"
                            type="url"
                            placeholder="https://api.day.app" /><small
                            >官方或自建服务均可。</small
                        ></label
                    >
                    <div
                        v-for="(_key, index) in channel.deviceKeys"
                        :key="index"
                        class="notification-row">
                        <label class="notification-field"
                            >设备 Key<input
                                v-model.trim="channel.deviceKeys[index]"
                                type="password"
                                autocomplete="off"
                        /></label>
                        <UiButton variant="ghost" @click="channel.deviceKeys.splice(index, 1)"
                            >移除</UiButton
                        >
                    </div>
                    <UiButton variant="ghost" @click="channel.deviceKeys.push('')"
                        >添加设备</UiButton
                    >
                    <label class="notification-check"
                        ><input v-model="channel.allowPrivateNetwork" type="checkbox" />
                        允许自建内网或本机 HTTP 服务</label
                    >
                </template>
                <label class="notification-check"
                    ><input v-model="channel.includeChallengeLink" type="checkbox" />
                    登录交互通知附验证材料和管理台链接（Bark 仅链接）</label
                >
                <div class="notification-row">
                    <UiButton
                        variant="ghost"
                        :disabled="dirty || busy"
                        :aria-describedby="
                            dirty ? `notification-test-hint-${channel.id}` : undefined
                        "
                        @click="emit('test', channel.id)"
                        >发送测试</UiButton
                    >
                    <span
                        v-if="dirty"
                        :id="`notification-test-hint-${channel.id}`"
                        class="notification-action-hint"
                        >先保存配置，再发送测试</span
                    >
                    <UiButton variant="danger" @click="removeChannel(channel.id)"
                        ><IconTrash :size="16" /> 删除渠道</UiButton
                    >
                </div>
            </details>
        </div>
    </div>
</template>
