import { CommonAction } from "./common"
import { FriendAction } from "./friend"
import { GroupAction } from "./group"
import { Mixin } from "@/utils"

export interface Action extends CommonAction, FriendAction, GroupAction {}

export class Action extends Mixin(CommonAction, FriendAction, GroupAction) {}
