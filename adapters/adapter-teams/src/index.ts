import { AdapterRegistry } from 'onebots';
import type { Schema } from 'onebots';

/**
 * Microsoft Teams 适配器
 * @onebots/adapter-teams
 */
export { TeamsAdapter } from './adapter.js';
export { TeamsBot } from './bot.js';
export type { TeamsConfig, TeamsUser, TeamsChannel, TeamsMessage, TeamsActivity, TeamsEvent } from './types.js';

const teamsSchema: Schema = {
	account_id: { type: 'string', required: true, label: '账号标识' },
	app_id: { type: 'string', required: true, label: 'App ID' },
	app_password: { type: 'string', required: true, label: 'App Password' },
	webhook: {
		url: { type: 'string', label: 'Webhook URL' },
		port: { type: 'number', label: 'Webhook 端口' },
	},
	channel_service: { type: 'string', label: 'Channel Service URL' },
	open_id_metadata: { type: 'string', label: 'OpenID Metadata URL' },
};

AdapterRegistry.registerSchema('teams', teamsSchema);

