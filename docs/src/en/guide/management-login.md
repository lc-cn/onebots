# Management login and recovery

::: tip Version boundary
This page applies to releases containing the persistent manager. Legacy images do not implement device sessions; replace the whole image while preserving `/data` when upgrading.
:::

The Web console uses device pairing. A short-lived code authorizes the browser, which then uses a server-issued session. Do not configure a management username, password, or `access_token`, or put credentials in URLs.

## First connection

Start the management service, then run on its machine:

This command requires the local control socket on Linux/macOS, a Docker container, or the Windows SCM service. Windows foreground `serve` does not create a local management pipe; use the one-time deployment-code flow in the [Windows source setup](/en/guide/start).

```bash
onebots auth bootstrap --data-dir /path/to/data
# Docker: replace onebots with your container name
docker exec onebots onebots auth bootstrap --data-dir /data
```

Enter the code on the console pairing page within five minutes. It is single-use; do not share it in chats or logs. No adapter, account, or protocol is required to open the management console.

## Add devices and manage sessions

In an authorized Web console, open **System → Devices & Access** and select **Generate device code**. Enter the single-use code in the new browser within five minutes. It is shown only for this visit; leaving the page, expiry, or generating another code hides or replaces it. Alternatively, run `onebots auth device --data-dir /path/to/data` on the manager host (or through `docker exec`), or use the TUI authorize-new-browser action. Adding a device keeps existing sessions valid.

The console lists session IDs, authorization and expiry times, and the current device. Revoke individual sessions after confirmation. Up to 16 active sessions are supported. Choose a 30-, 90-, or 365-day session lifetime (30 days by default). With automatic renewal enabled, an active browser checks periodically and renews its own still-valid session only when the deadline approaches or the policy changes. Closing the browser or allowing a session to expire does not renew it in the background. You can also check renewal manually. Saving a changed lifetime immediately updates the current browser, not other devices. Session IDs are not credentials; pairing codes remain short-lived and single-use.

Legacy sessions without an issuance time require authorization again; sessions with an existing deadline retain it. After the authentication store is upgraded, do not downgrade to a manager that cannot read the multi-device format or restore old authentication files to revive revoked credentials.

## Sign out and reconnect

**Sign out** asks the server to persistently revoke the session, then clears browser credentials after confirmation. **Clear local credentials** only removes the browser copy; it does not revoke the server session. A failed sign-out request is not reported as confirmed revocation.

An already paired workspace does not reopen initial setup. Use `auth device` to reconnect without revoking others. To regain control and revoke all previous devices, run:

```bash
onebots auth recover --data-dir /path/to/data
# Docker
docker exec onebots onebots auth recover --data-dir /data
```

Enter the recovery code on the same pairing page. Issuing it preserves existing sessions; successful redemption revokes all prior devices and outstanding additional-device codes, keeping only the new session.

## Deployments without a terminal

Use the deployment platform's private runtime Secrets:

1. For initial pairing set `ONEBOTS_BOOTSTRAP_CODE`; for an already paired workspace set `ONEBOTS_RECOVERY_CODE`. Never set both.
2. Generate a fresh 32-byte random code and save it as a private **Secret**, never a public Variable, build argument, or repository file.
3. Restart the manager and enter the code on its pairing page within five minutes. Remove the Secret after successful pairing.

Generate a code on a trusted machine:

```bash
node --input-type=module -e "import { randomBytes } from 'node:crypto'; process.stdout.write(randomBytes(32).toString('base64url'))"
```

Restarting cannot reissue or extend an old code. Do not reuse codes across initial setup and recovery. An unexpired local recovery code takes priority: use it or wait for expiry before injecting another fresh deployment code. Each deployment-code category retains at most 16 codes; after reaching the limit, use local recovery.

See [Docker deployment](/en/guide/docker) for HF instructions. Local HF container recovery has been tested; the actual HF cloud environment has not.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Initial pairing command is rejected | The workspace may already be paired. Use `auth recover`; do not delete authentication files. |
| Code is rejected | It may have expired, been used, or been replaced. Request a fresh code. After repeated failed attempts, wait one minute before retrying. |
| Local command cannot connect | Check that the manager is running, its workspace matches `--data-dir`, and your OS user can access the local control connection. |
| Old browser loses access after sign-out | This is expected. Authorize again with a recovery code. |
| Deployment recovery does not work | Check the Secret name, conflicting codes, reused historical codes, and any still-valid local recovery code. |

Authentication lives in the private control directory and is not sent to the gateway as business configuration. Never edit or delete authentication files to bypass recovery. Platform credentials and protocol-output `access_token` settings are separate and remain unchanged.
