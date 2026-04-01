#!/usr/bin/env bun
/**
 * Cortex inbox — list and manage notifications.
 */
import { CortexClient, loadConfig } from "../../../packages/core/src/index";

const config = loadConfig();

const args = process.argv.slice(2);
const client = new CortexClient(config);

// Action mode: --ack/--read/--dismiss <id>
for (const action of ["ack", "read", "dismiss"] as const) {
  const idx = args.indexOf(`--${action}`);
  if (idx !== -1 && args[idx + 1]) {
    const id = args[idx + 1];
    const result = await client.transitionNotification(id, action);
    if (result.ok) {
      console.log(`Notification ${id.slice(0, 7)} marked as ${action}.`);
    } else {
      console.error(`Failed: ${result.error}`);
      process.exit(1);
    }
    process.exit(0);
  }
}

// List mode
let status: string | undefined;
const statusIdx = args.indexOf("--status");
if (statusIdx !== -1 && args[statusIdx + 1]) status = args[statusIdx + 1];

const notifications = await client.getNotifications(status ?? "pending,delivered", 20);
if (notifications.length === 0) {
  console.log("No pending notifications.");
  process.exit(0);
}

console.log(`\nCortex Inbox (${notifications.length} notifications)\n`);
for (const n of notifications) {
  const marker = n.priority === "high" ? "!!!" : n.priority === "medium" ? " ! " : "   ";
  console.log(`[${marker}] ${n.short_id}  ${n.title}  (${n.source_kind})`);
}
console.log("\nActions: --ack <id> | --read <id> | --dismiss <id>");
