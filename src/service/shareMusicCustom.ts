import { assert } from "console"
import { MusicPlatform } from "icqq"
import { Contactable } from "icqq/lib/internal"
import { MusicElem, musicFactory } from "icqq/lib/message"
import { pb } from "icqq/lib/core"
import { Encodable } from "icqq/lib/core/protobuf"
import { title } from "process"

/** 发送音乐分享(允许自定义参数) */
export async function shareMusic(this: Contactable, music: MusicElem) {
    const body = await buildMusic((this.gid || this.uid) as number, this.dm ? 0 : 1, music)
    await this.c.sendOidb("OidbSvc.0xb77_9", pb.encode(body))
}

/**
 * 构造频道b77音乐分享
 * @param channel_id {string} 子频道id
 * @param guild_id {string} 频道id
 * @param music 音乐分享数据
 */
export async function buildMusic(channel_id: string, guild_id: string, music: MusicElem): Promise<Encodable>
/**
 * 构造b77音乐分享
 * @param target {number} 群id或者好友qq
 * @param bu {0|1} 类型表示：0 为好友 1 为群
 * @param music 音乐分享数据
 */
export async function buildMusic(target: number, bu: 0 | 1, music: MusicElem): Promise<Encodable>
export async function buildMusic(target: string | number, bu: string | 0 | 1, music: MusicElem) {
	const { appid, package_name, sign, getMusicInfo } = musicFactory[music.platform];
	let style: 4 | 0 = 4
	try {
		let { singer=null, title=null, jumpUrl=null, musicUrl=null, preview=null } = music.id ? await getMusicInfo(music.id) : null
		singer = music['content'] || music.singer || singer // 自定义参数优先级高于默认值(gocq的参数名与icqq有区别，做下兼容)
		title = music.title || title
		jumpUrl = music.jumpUrl || jumpUrl
		musicUrl = music['url'] || music['voice'] || music.musicUrl || musicUrl
		preview = music['image'] ||  music.preview || preview
		if (!musicUrl) style = 0
		return {
			1: appid,
			2: 1,
			3: style,
			5: {
				1: 1,
				2: "0.0.0",
				3: package_name,
				4: sign
			},
			10: typeof bu === 'string' ? 3 : bu,
			11: target,
			12: {
				10: title,
				11: singer,
				12: "[分享]" + title,
				13: jumpUrl,
				14: preview,
				16: musicUrl,
			},
			19: typeof bu === 'string' ? Number(bu) : undefined
		}
	} catch (e) {
		throw new Error("unknown music id: " + music.id + ", in platform: " + music.platform + ", with title: " + title)
	}

}