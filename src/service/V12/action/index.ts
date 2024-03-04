import { CommonAction } from "./common";
import { FriendAction } from "./friend";
import { GroupAction } from "./group";
import { GuildAction } from "./guild";
import { Mixin } from "@/utils";

export interface Action extends CommonAction, FriendAction, GroupAction, GuildAction {}

export class Action extends Mixin(CommonAction, FriendAction, GroupAction, GuildAction) {}
