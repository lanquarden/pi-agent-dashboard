import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { hasPiWorktrees } from "../predicates.js";
import { PiWorktreesBadge } from "../PiWorktreesBadge.js";

function makeSession(text?: string): any {
  if (text === undefined) {
    return { uiDecorators: {} };
  }
  return {
    uiDecorators: {
      "footer-segment:pi-worktrees:workspace-state": {
        kind: "footer-segment",
        namespace: "pi-worktrees",
        id: "workspace-state",
        payload: { text },
      },
    },
  };
}

describe("hasPiWorktrees", () => {
  it("returns false for null", () => {
    expect(hasPiWorktrees(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(hasPiWorktrees(undefined)).toBe(false);
  });

  it("returns false when uiDecorators is absent", () => {
    expect(hasPiWorktrees({} as any)).toBe(false);
  });

  it("returns false when key is absent", () => {
    expect(hasPiWorktrees(makeSession())).toBe(false);
  });

  it("returns false when text is empty string", () => {
    expect(hasPiWorktrees(makeSession(""))).toBe(false);
  });

  it("returns true when text is a non-empty string", () => {
    expect(hasPiWorktrees(makeSession("⎇ feature/auth"))).toBe(true);
  });

  it("returns true for plain text workspace name", () => {
    expect(hasPiWorktrees(makeSession("🐳 devcontainer"))).toBe(true);
  });
});

describe("PiWorktreesBadge", () => {
  it("renders null when uiDecorators key is absent", () => {
    const { container } = render(
      <PiWorktreesBadge session={makeSession()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders null when text is empty", () => {
    const { container } = render(
      <PiWorktreesBadge session={makeSession("")} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the text when present", () => {
    const { getByTestId } = render(
      <PiWorktreesBadge session={makeSession("⎇ feature/auth")} />,
    );
    const badge = getByTestId("pi-worktrees-badge");
    expect(badge.textContent).toBe("⎇ feature/auth");
  });

  it("has data-testid='pi-worktrees-badge'", () => {
    const { container } = render(
      <PiWorktreesBadge session={makeSession("main")} />,
    );
    expect(container.querySelector('[data-testid="pi-worktrees-badge"]')).toBeTruthy();
  });

  it("has correct title attribute", () => {
    const { container } = render(
      <PiWorktreesBadge session={makeSession("⎇ feature/auth")} />,
    );
    expect(
      container.querySelector('[data-testid="pi-worktrees-badge"]')?.getAttribute("title"),
    ).toBe("⎇ feature/auth");
  });
});
