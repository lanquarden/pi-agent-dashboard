/**
 * Unit tests for the ctx.ui.notify patch logic introduced by
 * openspec/changes/bash-dispatch-chips (task 1.1).
 *
 * Tests the normalisation of `levelOrOpts` (string | object) into
 * level / toolCallId / method / extraProps and the resulting
 * prompt_request shape sent over the connection.
 */
import { describe, it, expect, vi } from "vitest";

// Re-create the patched notify logic inline so we can unit-test it
// without spinning up the full bridge session_start handler.
function makeNotify(
  connection: { send: (msg: unknown) => void },
  sessionId: string,
  originalNotify?: (msg: string, level?: string) => void,
) {
  const buildMeta = (opts: any): Record<string, unknown> | undefined => {
    const toolCallId = opts?.toolCallId;
    if (!toolCallId) return undefined;
    return { toolCallId };
  };

  return (
    message: string,
    levelOrOpts?: string | { toolCallId?: string; level?: string; method?: string; props?: Record<string, unknown> },
  ) => {
    const level =
      typeof levelOrOpts === "string" ? levelOrOpts : (levelOrOpts?.level ?? undefined);
    const toolCallId =
      typeof levelOrOpts === "object" ? levelOrOpts?.toolCallId : undefined;
    const method =
      (typeof levelOrOpts === "object" ? levelOrOpts?.method : undefined) ?? "notify";
    const extraProps =
      typeof levelOrOpts === "object" ? (levelOrOpts?.props ?? {}) : {};

    if (originalNotify) (originalNotify as unknown as (msg: string, level?: string) => void)(message, level);
    connection.send({
      type: "prompt_request",
      sessionId,
      promptId: "test-uuid",
      prompt: { question: message, type: method, metadata: buildMeta({ toolCallId }) },
      component: { type: method, props: { message, level, ...extraProps } },
      placement: "inline",
    });
  };
}

describe("ctx.ui.notify patch (bridge-notify-opts)", () => {
  function setup() {
    const send = vi.fn();
    const connection = { send: send as (msg: unknown) => void };
    const originalNotify = vi.fn() as unknown as (msg: string, level?: string) => void;
    const notify = makeNotify(connection, "s1", originalNotify);
    return { send, connection, originalNotify, notify };
  }

  describe("string level (legacy form)", () => {
    it("sets prompt.type = 'notify'", () => {
      const { send, notify } = setup();
      notify("Hello", "info");
      const msg = send.mock.calls[0][0];
      expect(msg.prompt.type).toBe("notify");
    });

    it("sets component.type = 'notify'", () => {
      const { send, notify } = setup();
      notify("Hello", "info");
      const msg = send.mock.calls[0][0];
      expect(msg.component.type).toBe("notify");
    });

    it("sets component.props.level", () => {
      const { send, notify } = setup();
      notify("Hello", "info");
      const msg = send.mock.calls[0][0];
      expect(msg.component.props.level).toBe("info");
    });

    it("does not set prompt.metadata", () => {
      const { send, notify } = setup();
      notify("Hello", "info");
      const msg = send.mock.calls[0][0];
      expect(msg.prompt.metadata).toBeUndefined();
    });

    it("calls originalNotify with message and level", () => {
      const { originalNotify, notify } = setup();
      notify("Hello", "warn");
      expect(originalNotify).toHaveBeenCalledWith("Hello", "warn");
    });
  });

  describe("object opts with toolCallId + method + props", () => {
    it("sets prompt.type = method", () => {
      const { send, notify } = setup();
      notify("cmd", { toolCallId: "tc-1", method: "bash-dispatch", props: { routing: "host" } });
      const msg = send.mock.calls[0][0];
      expect(msg.prompt.type).toBe("bash-dispatch");
    });

    it("sets component.type = method", () => {
      const { send, notify } = setup();
      notify("cmd", { toolCallId: "tc-1", method: "bash-dispatch", props: { routing: "host" } });
      const msg = send.mock.calls[0][0];
      expect(msg.component.type).toBe("bash-dispatch");
    });

    it("sets prompt.metadata.toolCallId", () => {
      const { send, notify } = setup();
      notify("cmd", { toolCallId: "tc-1", method: "bash-dispatch", props: { routing: "host" } });
      const msg = send.mock.calls[0][0];
      expect(msg.prompt.metadata?.toolCallId).toBe("tc-1");
    });

    it("includes extra props in component.props", () => {
      const { send, notify } = setup();
      notify("cmd", { toolCallId: "tc-1", method: "bash-dispatch", props: { routing: "host" } });
      const msg = send.mock.calls[0][0];
      expect(msg.component.props.routing).toBe("host");
    });

    it("calls originalNotify with message and undefined level when no level in opts", () => {
      const { originalNotify, notify } = setup();
      notify("cmd", { toolCallId: "tc-1", method: "bash-dispatch" });
      expect(originalNotify).toHaveBeenCalledWith("cmd", undefined);
    });
  });

  describe("object opts with toolCallId only (method defaults to 'notify')", () => {
    it("prompt.type defaults to 'notify'", () => {
      const { send, notify } = setup();
      notify("msg", { toolCallId: "tc-2" });
      const msg = send.mock.calls[0][0];
      expect(msg.prompt.type).toBe("notify");
    });

    it("component.type defaults to 'notify'", () => {
      const { send, notify } = setup();
      notify("msg", { toolCallId: "tc-2" });
      const msg = send.mock.calls[0][0];
      expect(msg.component.type).toBe("notify");
    });

    it("prompt.metadata.toolCallId is set", () => {
      const { send, notify } = setup();
      notify("msg", { toolCallId: "tc-2" });
      const msg = send.mock.calls[0][0];
      expect(msg.prompt.metadata?.toolCallId).toBe("tc-2");
    });
  });

  describe("no opts (bare call)", () => {
    it("prompt.type = 'notify', no metadata", () => {
      const { send, notify } = setup();
      notify("bare");
      const msg = send.mock.calls[0][0];
      expect(msg.prompt.type).toBe("notify");
      expect(msg.prompt.metadata).toBeUndefined();
    });
  });
});
