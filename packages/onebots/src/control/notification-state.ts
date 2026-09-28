import { emptyNotificationConfig } from "./notification-config.js";
import type { NotificationConfig, NotificationDelivery } from "./notification-types.js";

export interface NotificationAccountState {
    status: "pending" | "online" | "offline";
    everOnline: boolean;
    offlineAt?: number;
    disconnected?: boolean;
}

export interface NotificationState {
    schemaVersion: 1;
    config: NotificationConfig;
    deliveries: NotificationDelivery[];
    accounts: Record<string, NotificationAccountState>;
    seenChallenges: string[];
    seenOperations: string[];
    droppedDeliveries: number;
}

export function initialNotificationState(): NotificationState {
    return {
        schemaVersion: 1,
        config: emptyNotificationConfig(),
        deliveries: [],
        accounts: {},
        seenChallenges: [],
        seenOperations: [],
        droppedDeliveries: 0,
    };
}
