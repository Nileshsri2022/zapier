# Discord Action Via Incoming Webhooks

## Context
ZapMate automates workflows by executing actions in response to trigger events. Users need to send real-time notifications to Discord channels (e.g. sales alerts, Solana transaction confirmations, new form leads). 

There were two technical routes considered:
1. **Discord Application with OAuth2 / Gateway Connection**: Requiring users to create an application in the Discord Developer Portal, configure application scopes/permissions, invite the application to their server, and manage application tokens.
2. **Discord Incoming Webhooks**: Allowing users to create a webhook URL in their Discord channel settings (`https://discord.com/api/webhooks/{id}/{token}`) and paste it directly into the action configuration.

## Decision
We chose **Discord Incoming Webhooks** stored directly in `Action.metadata`.

Why:
- **Zero friction**: Users connect in under 30 seconds without creating developer portal apps or navigating OAuth permission approval screens.
- **Granular channel isolation**: Webhooks are scoped directly to a specific channel. Different Zaps can notify different channels or even entirely different Discord servers without multi-tenant credential conflicts.
- **Stateless execution**: No OAuth refresh tokens, no gateway websocket connections, and no token expiration failures in the background worker.

## Consequences
- The action is strictly one-way (outbound messaging and alerts).
- Interactive features (slash commands, listening to messages in Discord, role management) are out of scope for this action.
