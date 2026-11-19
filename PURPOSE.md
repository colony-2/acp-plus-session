# acp-plus-session

acp-plus-session provides reusable local application wrappers around Agent Client Protocol coding-agent adapters, initially Codex and Claude. It uses the same upstream base adapters selected by acpx and adds import and export of resumable session state as opaque files/directories plus JSON.

The cell owns the wrapper library and command-line entrypoints, ACP extension negotiation, versioned checkpoint envelope, provider-specific snapshot and restoration code, user-configured import/export hooks, local session isolation and process lifecycle, packaging, documentation, and compatibility tests. Applications can transport checkpoints without understanding provider internals or depending on C2 runtime services.

Local execution means wrapper processes, adapters, state storage, and workspace tools can run on the user's machine. Model inference and authentication may still depend on network services. Credentials and repository contents are supplied separately from session checkpoints.

Upstream adapters and agent runtimes retain their protocol and provider behavior. acpx retains its client and session-management responsibilities. c2ops retains its recipe operations and existing object-session contracts. This cell does not own workflow scheduling, durable remote object storage, cloud execution, or conversion of conversations between providers.
