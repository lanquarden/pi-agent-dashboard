import { describe, it, expect } from "vitest";
import { registerInteractiveRenderer } from "../index.js";
import { getInteractiveRenderer } from "../../../client/src/components/interactive-renderers/registry.js";
import { GenericInteractiveRenderer } from "../../../client/src/components/interactive-renderers/GenericInteractiveRenderer.js";
import React from "react";

describe("registerInteractiveRenderer (re-exported from plugin runtime)", () => {
  it("is a function", () => {
    expect(typeof registerInteractiveRenderer).toBe("function");
  });

  it("registered renderer is returned by getInteractiveRenderer", () => {
    const MockRenderer = () => React.createElement("div", null, "mock");
    registerInteractiveRenderer("test-method-unique", MockRenderer);
    expect(getInteractiveRenderer("test-method-unique")).toBe(MockRenderer);
  });

  it("unknown method returns GenericInteractiveRenderer", () => {
    expect(getInteractiveRenderer("totally-unknown-method-xyz")).toBe(GenericInteractiveRenderer);
  });
});
