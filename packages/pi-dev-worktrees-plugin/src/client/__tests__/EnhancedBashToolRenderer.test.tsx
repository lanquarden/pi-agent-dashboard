import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { EnhancedBashToolRenderer } from "../EnhancedBashToolRenderer.js";

const EVENT_KEY = "pi-dev-worktrees:bash-dispatch";

function makeProps(overrides: Record<string, any> = {}): any {
  return {
    toolName: "bash",
    args: { command: "echo hello" },
    status: "complete",
    result: "hello\n",
    images: [],
    context: { cwd: "/tmp", editors: [] },
    ...overrides,
  };
}

function withDispatch(command: string, dispatch: Record<string, unknown>) {
  return { args: { command, _pluginData: { [EVENT_KEY]: dispatch } } };
}

describe("EnhancedBashToolRenderer", () => {
  it("renders command without chips when no _pluginData", () => {
    const { container } = render(<EnhancedBashToolRenderer {...makeProps()} />);
    expect(container.textContent).toContain("echo hello");
    expect(container.querySelector("[title]")).toBeNull();
  });

  it("renders RTK chip when rtkRewritten", () => {
    const props = makeProps(withDispatch("npm test", {
      rtkRewritten: true, rtkCommand: "npm test -- --reporter=json", routing: "host",
    }));
    render(<EnhancedBashToolRenderer {...props} />);
    expect(screen.getByText("RTK")).toBeTruthy();
    expect(screen.getByText("RTK").getAttribute("title")).toBe("npm test -- --reporter=json");
  });

  it("renders container chip", () => {
    const props = makeProps(withDispatch("make build", { routing: "container" }));
    render(<EnhancedBashToolRenderer {...props} />);
    expect(screen.getByText("container")).toBeTruthy();
  });

  it("renders host chip only when hasDevcontainer", () => {
    const props = makeProps(withDispatch("git status", { routing: "host", hasDevcontainer: true }));
    render(<EnhancedBashToolRenderer {...props} />);
    expect(screen.getByText("host")).toBeTruthy();
  });

  it("does not render host chip without hasDevcontainer", () => {
    const props = makeProps(withDispatch("git status", { routing: "host", hasDevcontainer: false }));
    const { container } = render(<EnhancedBashToolRenderer {...props} />);
    expect(container.textContent).not.toContain("host");
  });

  it("renders error chip", () => {
    const props = makeProps(withDispatch("bad cmd", { routing: "error" }));
    render(<EnhancedBashToolRenderer {...props} />);
    expect(screen.getByText("error")).toBeTruthy();
  });

  it("shows result text when complete", () => {
    const props = makeProps({
      ...withDispatch("ls", { routing: "host", hasDevcontainer: true }),
      result: "file.txt\n",
    });
    render(<EnhancedBashToolRenderer {...props} />);
    expect(screen.getByText("file.txt")).toBeTruthy();
  });

  it("shows Running… when status is running and no result", () => {
    const props = makeProps({
      ...withDispatch("sleep 10", { routing: "container" }),
      status: "running",
      result: undefined,
    });
    render(<EnhancedBashToolRenderer {...props} />);
    expect(screen.getByText("Running…")).toBeTruthy();
  });
});
