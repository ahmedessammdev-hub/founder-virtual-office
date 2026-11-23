#!/usr/bin/env node
import readline from "node:readline";

/**
 * Lightweight stdio-to-HTTP JSON-RPC 2.0 proxy for `office-mcp`.
 * Spawned by CLIs (`agy`, `codex`, `claude`) so concurrent runs each authenticate
 * with their own isolated `OFFICE_RUN_TOKEN` from child process environment variables.
 */
const mcpUrl = process.env.OFFICE_MCP_URL ?? "http://127.0.0.1:4310/mcp";
const runToken = process.env.OFFICE_RUN_TOKEN ?? "";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", async (rawLine) => {
  const line = rawLine.trim();
  if (!line) return;

  let reqId: string | number | null = null;
  try {
    const parsed = JSON.parse(line) as { id?: string | number | null };
    reqId = parsed.id ?? null;

    const resp = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runToken}`,
      },
      body: line,
    });

    const text = await resp.text();
    if (text.trim()) {
      process.stdout.write(`${text.trim()}\n`);
    }
  } catch (err) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: reqId,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : "office-mcp-proxy bridge error",
        },
      })}\n`,
    );
  }
});
