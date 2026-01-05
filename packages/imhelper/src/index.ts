export * from './adapter.js';
export * from './imhelper.js';
export * from './message.js';
export * from './instances/user.js';
export * from './instances/group.js';
export * from './instances/channel.js';
export * from './instances/friend.js';
export * from './instances/groupMember.js';
export * from './instances/channelMember.js';
export * from './receiver.js';
export * from './receivers/ws.js';
export * from './receivers/wss.js';
export * from './receivers/webhook.js';
export * from './receivers/sse.js';
export * from './events/index.js';

import { Adapter } from './adapter.js';
import { ImHelper } from './imhelper.js';

/**
 * 创建统一的消息助手
 */
export function createImHelper<Id extends string | number>(
  adapter: Adapter<Id>
): ImHelper<Id> {
  return new ImHelper<Id>(adapter);
}

