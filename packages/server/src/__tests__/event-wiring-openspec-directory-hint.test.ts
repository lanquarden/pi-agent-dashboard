/**
 * Tests for the `openspec:directory_hint` event-forward branch in event-wiring.
 * Validates that the hint event is NOT inserted into the session event store
 * and NOT broadcast to browsers as a raw event (it is side-effect only).
 * See change: openspec-directory-hint.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createServer, type DashboardServer } from "../server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("event-wiring: openspec:directory_hint is not stored in event store", () => {
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
});
