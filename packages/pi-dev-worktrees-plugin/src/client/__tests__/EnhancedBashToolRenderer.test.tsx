import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { EnhancedBashToolRenderer } from "../EnhancedBashToolRenderer.js";

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

describe("EnhancedBashToolRenderer", () => {
  it("renders command without chips when no _dispatch", () => {
    const { container } = render(<EnhancedBashToolRenderer {...makeProps()} />);
    expect(container.textContent).toContain("echo hello");
    expect(container.querySelector("[title]")).toBeNull();
  });

  it("renders RTK chip when rtkRewritten", () => {
    const props = makeProps({
      args: {
        command: "npm test",
        _dispatch: { rtkRewritten: true, rtkCommand: "npm test -- --reporter=json", routing: "host" },
      },
    });
    render(<EnhancedBashToolRenderer {...props} />);
    expect(screen.getByText("RTK")).toBeTruthy();
    expect(screen.getByText("RTK").getAttribute("title")).toBe("npm test -- --reporter=json");
  });

  it("renders container chip", () => {
    const props = makeProps({
      args: {
        command: "make build",
        _dispatch: { routing: "container" },
      },
    });
    render(<EnhancedBashToolRenderer {...props} />);
    expect(screen.getByText("container")).toBeTruthy();
  });

  it("renders host chip only when hasDevcontainer", () => {
    const props = makeProps({
      args: {
        command: "git status",
        _dispatch: { routing: "host", hasDevcontainer: true },
      },
    });
    render(<EnhancedBashToolRenderer {...props} />);
    expect(screen.getByText("host")).toBeTruthy();
  });

  it("does not render host chip without hasDevcontainer", () => {
    const props = makeProps({
      args: {
        command: "git status",
        _dispatch: { routing: "host", hasDevcontainer: false },
      },
    });
    const { container } = render(<EnhancedBashToolRenderer {...props} />);
    expect(container.textContent).not.toContain("host");
  });

  it("renders error chip", () => {
    const props = makeProps({
      args: {
        command: "bad cmd",
        _dispatch: { routing: "error" },
      },
    });
    render(<EnhancedBashToolRenderer {...props} />);
    expect(screen.getByText("error")).toBeTruthy();
  });

  it("shows result text when complete", () => {
    const props = makeProps({
      args: { command: "ls", _dispatch: { routing: "host", hasDevcontainer: true } },
      result: "file.txt\n",
    });
    render(<EnhancedBashToolRenderer {...props} />);
    expect(screen.getByText("file.txt")).toBeTruthy();
  });

  it("shows Running… when status is running and no result", () => {
    const props = makeProps({
      args: { command: "sleep 10", _dispatch: { routing: "container" } },
      status: "running",
      result: undefined,
    });
    render(<EnhancedBashToolRenderer {...props} />);
    expect(screen.getByText("Running…")).toBeTruthy();
  });
});
