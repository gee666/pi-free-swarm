// Shared wire-level status and identity types.
export type SwarmStatus = "starting" | "running" | "finished" | "stopped" | "interrupted";
export type ParticipantKind = "agent" | "user" | "main" | "system";
/** Only agents have a status. */
export type ParticipantStatus = "pending" | "starting" | "working" | "idle" | "crashed" | "stopped" | "retired";
/** `pending → delivered → read` never goes backwards; `undeliverable` is final. */
export type RecipientStatus = "pending" | "delivered" | "read" | "undeliverable";
export type AgentRunEndReason = "settled" | "crashed" | "stopped";
export type ReservedName = "User" | "Main" | "System" | "Watcher";
export type MailboxKind = "inbox" | "sent";
/** What an agent is doing right now; `null` when idle or not running. */
export type AgentActivity = { kind: "thinking" } | { kind: "writing" } | { kind: "tool"; toolName: string };
