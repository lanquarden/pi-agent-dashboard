/**
 * Tests for the `openspec:directory_hint` event-forward branch in event-wiring.
 * Validates that:
 * - hint sets session.openspecCwd and broadcasts session_updated
 * - hint event is NOT inserted into the session event store
 * - missing/empty path is a no-op
 * See change: openspec-directory-hint.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createServer, type DashboardServer } from "../server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function connectBrowser(port: number): Promise<{ ws: WebSocket; messages: unknown[] }> {
  const messages: unknown[] = [];
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.on("error", reject);
    ws.on("message", (raw) => {
      try { messages.push(JSON.parse(raw.toString())); } catch { /* ignore */ }
    });
    ws.on("open", () => resolve({ ws, messages }));
  });
}

describe("event-wiring: openspec:directory_hint", () => {
  let server: DashboardServer;
  let piPort: number;
  let browserPort: number;
  let testPort = 19900;

  beforeEach(async () => {
    testPort += 2;
    browserPort = testPort;
    piPort = testPort + 1;
    server = await createServer({
      port: browserPort,
      piPort,
      dev: true,
      autoShutdown: false,
      shutdownIdleSeconds: 999,
      tunnel: false,
      editor: { idleTimeoutMinutes: 10, maxInstances: 3 },
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("does not insert openspec:directory_hint into the event store", async () => {
    const { eventStore } = server;
    const SID = "hint-valid-sess";
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-hint-test-"));
    const sessionFile = path.join(tmpDir, "s.jsonl");
    writeFileSync(sessionFile, "");

    const ws = new WebSocket(`ws://localhost:${piPort}`);
    await new Promise<void>((resolve, reject) => {
      ws.on("error", reject);
      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "session_register",
          sessionId: SID,
          cwd: tmpDir,
          source: "cli",
          sessionFile,
        }));
        ws.send(JSON.stringify({ type: "replay_complete", sessionId: SID }));
        resolve();
      });
    });
    await wait(80);

    const worktreePath = path.join(tmpDir, "worktree-branch");
    const seqBefore = eventStore.getMaxSeq(SID);

    ws.send(JSON.stringify({
      type: "event_forward",
      sessionId: SID,
      event: {
        eventType: "openspec:directory_hint",
        timestamp: Date.now(),
        data: { path: worktreePath },
      },
    }));
    await wait(80);

    // Event MUST NOT be stored in the session event store
    expect(eventStore.getMaxSeq(SID)).toBe(seqBefore);

    ws.close();
  });

  it("does not insert openspec:directory_hint with missing path into the event store", async () => {
    const { eventStore } = server;
    const SID = "hint-noop-sess";
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-hint-noop-"));
    const sessionFile = path.join(tmpDir, "s.jsonl");
    writeFileSync(sessionFile, "");

    const ws = new WebSocket(`ws://localhost:${piPort}`);
    await new Promise<void>((resolve, reject) => {
      ws.on("error", reject);
      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "session_register",
          sessionId: SID,
          cwd: tmpDir,
          source: "cli",
          sessionFile,
        }));
        ws.send(JSON.stringify({ type: "replay_complete", sessionId: SID }));
        resolve();
      });
    });
    await wait(80);

    const seqBefore = eventStore.getMaxSeq(SID);

    // No path field — no-op, no store insert, no error
    ws.send(JSON.stringify({
      type: "event_forward",
      sessionId: SID,
      event: {
        eventType: "openspec:directory_hint",
        timestamp: Date.now(),
        data: {},
      },
    }));
    // Empty string path — no-op
    ws.send(JSON.stringify({
      type: "event_forward",
      sessionId: SID,
      event: {
        eventType: "openspec:directory_hint",
        timestamp: Date.now(),
        data: { path: "" },
      },
    }));
    await wait(80);

    expect(eventStore.getMaxSeq(SID)).toBe(seqBefore);

    ws.close();
  });

  it("sets session.openspecCwd to the hinted path", async () => {
    const { sessionManager } = server;
    const SID = "hint-cwd-sess";
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-hint-cwd-"));
    const sessionFile = path.join(tmpDir, "s.jsonl");
    writeFileSync(sessionFile, "");

    const ws = new WebSocket(`ws://localhost:${piPort}`);
    await new Promise<void>((resolve, reject) => {
      ws.on("error", reject);
      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "session_register",
          sessionId: SID,
          cwd: tmpDir,
          source: "cli",
          sessionFile,
        }));
        ws.send(JSON.stringify({ type: "replay_complete", sessionId: SID }));
        resolve();
      });
    });
    await wait(80);

    expect(sessionManager.get(SID)?.openspecCwd).toBeUndefined();

    const worktreePath = path.join(tmpDir, "my-feature");
    ws.send(JSON.stringify({
      type: "event_forward",
      sessionId: SID,
      event: {
        eventType: "openspec:directory_hint",
        timestamp: Date.now(),
        data: { path: worktreePath },
      },
    }));
    await wait(80);

    expect(sessionManager.get(SID)?.openspecCwd).toBe(worktreePath);

    ws.close();
  });

  it("broadcasts session_updated with openspecCwd to browser subscribers", async () => {
    const SID = "hint-broadcast-sess";
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-hint-bcast-"));
    const sessionFile = path.join(tmpDir, "s.jsonl");
    writeFileSync(sessionFile, "");

    // Register session via bridge first
    const bridgeWs = new WebSocket(`ws://localhost:${piPort}`);
    await new Promise<void>((resolve, reject) => {
      bridgeWs.on("error", reject);
      bridgeWs.on("open", () => {
        bridgeWs.send(JSON.stringify({
          type: "session_register",
          sessionId: SID,
          cwd: tmpDir,
          source: "cli",
          sessionFile,
        }));
        bridgeWs.send(JSON.stringify({ type: "replay_complete", sessionId: SID }));
        resolve();
      });
    });
    await wait(80);

    // Connect browser and subscribe after session is known
    const { ws: browserWs, messages } = await connectBrowser(browserPort);
    browserWs.send(JSON.stringify({ type: "subscribe", sessionId: SID, lastSeq: 0 }));
    await wait(40);

    const worktreePath = path.join(tmpDir, "feature-branch");
    bridgeWs.send(JSON.stringify({
      type: "event_forward",
      sessionId: SID,
      event: {
        eventType: "openspec:directory_hint",
        timestamp: Date.now(),
        data: { path: worktreePath },
      },
    }));
    await wait(80);

    const update = (messages as any[]).find(
      (m) => m.type === "session_updated" && m.sessionId === SID && m.updates?.openspecCwd,
    );
    expect(update).toBeDefined();
    expect(update.updates.openspecCwd).toBe(worktreePath);

    bridgeWs.close();
    browserWs.close();
  });
});
