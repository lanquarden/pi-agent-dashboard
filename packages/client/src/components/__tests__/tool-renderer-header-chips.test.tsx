import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { registerToolRenderer, getToolRenderer, getToolHeaderChips } from "../tool-renderers/index.js";

function DummyRenderer() {
  return <div>dummy</div>;
}

describe("registerToolRenderer headerChips", () => {
  afterEach(() => {
    // Reset by re-registering without opts (no headerChips)
    registerToolRenderer("__test_tool__", DummyRenderer);
  });

  it("returns undefined when no headerChips registered", () => {
    registerToolRenderer("__test_tool__", DummyRenderer);
    expect(getToolHeaderChips("__test_tool__")).toBeUndefined();
  });

  it("stores and returns headerChips function", () => {
    const chipsFn = (args?: Record<string, unknown>) => <span>chip</span>;
    registerToolRenderer("__test_tool__", DummyRenderer, { headerChips: chipsFn });
    expect(getToolHeaderChips("__test_tool__")).toBe(chipsFn);
  });

  it("overwrites headerChips on re-registration", () => {
    const chipsFn1 = () => <span>1</span>;
    const chipsFn2 = () => <span>2</span>;
    registerToolRenderer("__test_tool__", DummyRenderer, { headerChips: chipsFn1 });
    registerToolRenderer("__test_tool__", DummyRenderer, { headerChips: chipsFn2 });
    expect(getToolHeaderChips("__test_tool__")).toBe(chipsFn2);
  });

  it("returns undefined for unregistered tool names", () => {
    expect(getToolHeaderChips("nonexistent_tool_xyz")).toBeUndefined();
  });
});
