export const GOOGLE_CHAT_INTERACTION_TYPES = [
    "MESSAGE",
    "ADDED_TO_SPACE",
    "REMOVED_FROM_SPACE",
    "CARD_CLICKED",
    "WIDGET_UPDATED",
    "APP_COMMAND",
    "APP_HOME",
    "SUBMIT_FORM",
] as const;

export type GoogleChatInteractionType = (typeof GOOGLE_CHAT_INTERACTION_TYPES)[number];

export const GOOGLE_CHAT_INTERACTION_TYPE_SET = new Set<string>(GOOGLE_CHAT_INTERACTION_TYPES);

export const GOOGLE_CHAT_WORKSPACE_EVENT_TYPES = [
    "google.workspace.chat.message.v1.created",
    "google.workspace.chat.message.v1.updated",
    "google.workspace.chat.message.v1.deleted",
    "google.workspace.chat.reaction.v1.created",
    "google.workspace.chat.reaction.v1.deleted",
    "google.workspace.chat.membership.v1.created",
    "google.workspace.chat.membership.v1.updated",
    "google.workspace.chat.membership.v1.deleted",
    "google.workspace.chat.space.v1.updated",
    "google.workspace.chat.space.v1.deleted",
    "google.workspace.chat.spaceReadState.v1.updated",
    "google.workspace.chat.threadReadState.v1.updated",
    "google.workspace.chat.availability.v1.updated",
] as const;

export const GOOGLE_CHAT_EVENT_TYPES = [
    ...GOOGLE_CHAT_INTERACTION_TYPES,
    ...GOOGLE_CHAT_WORKSPACE_EVENT_TYPES,
] as const;

export const GOOGLE_CHAT_WORKSPACE_EVENT_TYPE_SET = new Set<string>(
    GOOGLE_CHAT_WORKSPACE_EVENT_TYPES,
);
