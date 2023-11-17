import { ChannelSubType, ChannelType, PrivateType, SpeakPermission } from "../constans";
export namespace Channel {
    export interface Info {
        id: string
        guild_id: string
        name: string,
        type: ChannelType
        sub_type: ChannelSubType
        position: number
        parent_id?: string
        owner_id: string
        private_type: PrivateType
        speak_permission: SpeakPermission
        application_id?: string
        permissions?: string
    }
}
