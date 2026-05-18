import { describe, it, expect } from "vitest";
import { shouldApplyDefaultModel } from "../bridge-default-model-gate.js";

describe("shouldApplyDefaultModel", () => {
  const base = { hasModelRegistry: true, hasDefaultModel: true };

  it("applies for a brand-new session (reason=startup, entries=0)", () => {
    expect(shouldApplyDefaultModel({ ...base, reason: "startup", entryCount: 0 })).toBe(true);
  });

  it("does NOT apply for resumed sessions (entries>0, reason=startup)", () => {
    expect(shouldApplyDefaultModel({ ...base, reason: "startup", entryCount: 5 })).toBe(false);
  });

  it("does NOT apply for in-process new (reason=new)", () => {
    // pi handles its own default for in-process /new — bridge stays out
    expect(shouldApplyDefaultModel({ ...base, reason: "new", entryCount: 0 })).toBe(false);
  });

  it("does NOT apply for in-process resume (reason=resume)", () => {
    expect(shouldApplyDefaultModel({ ...base, reason: "resume", entryCount: 5 })).toBe(false);
  });

  it("does NOT apply for in-process fork (reason=fork)", () => {
    expect(shouldApplyDefaultModel({ ...base, reason: "fork", entryCount: 5 })).toBe(false);
  });

  it("does NOT apply for reload of in-flight session (reason=reload, entries>0)", () => {
    expect(shouldApplyDefaultModel({ ...base, reason: "reload", entryCount: 5 })).toBe(false);
  });

  it("does NOT apply when defaultModel is not configured", () => {
    expect(
      shouldApplyDefaultModel({ ...base, hasDefaultModel: false, reason: "startup", entryCount: 0 }),
    ).toBe(false);
  });

  it("does NOT apply when model registry not yet available", () => {
    expect(
      shouldApplyDefaultModel({ ...base, hasModelRegistry: false, reason: "startup", entryCount: 0 }),
    ).toBe(false);
  });

  it("does NOT apply when reason is undefined", () => {
    expect(shouldApplyDefaultModel({ ...base, reason: undefined, entryCount: 0 })).toBe(false);
  });
});
