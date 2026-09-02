# IRCv3

The IRCv3 adapter targets Modern IRC and stable IRCv3 extensions. Managed TCP/TLS, a host-owned socket, and `ingest(rawEvent)` all enter one `Ircv3Client` session state machine without opening a private listener.

## Resource and message mapping

- IRC channels map to canonical groups/channels; nicknames or accounts map to users.
- Channel PRIVMSG/NOTICE becomes a channel message; messages addressed to the bot nickname become direct messages.
- CTCP ACTION becomes action text and `+reply` becomes a reply segment.
- `account-tag` or the extended-join account is preferred as the stable user ID while the nickname remains the display name.
- JOIN/PART/QUIT/KICK, INVITE, TOPIC, MODE, and NICK/ACCOUNT/AWAY/CHGHOST/SETNAME map to canonical notices or requests.
- Uninterpreted stable messages retain the complete `raw_event` and `extensions.ircv3` data.

IRC has no standard media upload. Public HTTP(S) media URLs explicitly degrade to text, while `can_send_image` and `can_send_record` return false. TOPIC is a channel subject, not a channel name, so it is exposed as `set_irc_topic` rather than masquerading as canonical `set_group_name`.

## Negotiation, recovery, and request correlation

- CAP LS 302 handles multiline capability lists and ends negotiation after ACK/NAK.
- SASL PLAIN/EXTERNAL completes before CAP END; `sasl_required` prevents silent anonymous fallback.
- Managed connections default to TLS, bind an `AbortSignal`, retry indefinitely with jittered exponential backoff, and isolate old connections by generation.
- When labeled-response is available, requests and BATCH replies can run concurrently; WHOIS/NAMES/CHATHISTORY queries are serialized on legacy servers.
- A message `msgid` may be reused by history or retransmission, so canonical delivery IDs use connection generation plus occurrence sequence.
- Byte streams require CRLF and independently enforce the IRCv3 tag section and 512-byte main section limits.

## Platform capabilities

Canonical actions cover messages, history, user/channel/member queries, nickname, channel departure, kick/invite/operator changes, invitation handling, announcements, status, and version. Platform actions additionally expose JOIN/PART, NOTICE/ACTION, TOPIC/MODE, KICK/INVITE, WHOIS/NAMES, MONITOR, AWAY, SETNAME, typing, CHATHISTORY, the session snapshot, and controlled raw commands.

Capabilities narrow from live server state. History requires explicit negotiation of WIP `draft/chathistory` and its stable dependencies plus CHATHISTORY ISUPPORT; MONITOR, setname, and typing similarly depend on ISUPPORT, CAP ACK, and CLIENTTAGDENY. Configured `event_commands` bound the canonical events an account can produce.

Only stable capabilities are requested by default. `draft/multiline` remains work in progress and is not advertised as stable multipart messaging. Explicit vendor/draft capabilities are allowed, but unknown semantics remain in the raw message.

See [IRCv3 Configuration](/en/config/adapter/ircv3). Official references: [IRCv3 Specifications](https://ircv3.net/irc/), [Capability Negotiation](https://ircv3.net/specs/extensions/capability-negotiation.html), [Message Tags](https://ircv3.net/specs/extensions/message-tags.html), [SASL](https://ircv3.net/specs/extensions/sasl-3.2), and [Modern IRC](https://modern.ircdocs.horse/).
