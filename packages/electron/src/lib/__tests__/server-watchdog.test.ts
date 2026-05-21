/**
 * Unit tests for makeServerWatchdog + graceful-shutdown flag.
 *
 * Pure: no Electron boot, no fs access. All deps injected.
 * See change: harvest-bootstrap-survivor-fixes (cherry-pick 6b).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  makeServerWatchdog,
  setGracefulShutdownInProgress,
  isGracefulShutdownInProgress,
  setSpawnedPid,
} from "../server-lifecycle.js";

describe("gracefulShutdownInProgress flag", () => {
  beforeEach(() => {
    // Reset to known state before each test
    setGracefulShutdownInProgress(false);
  });

  it("defaults to false", () => {
    expect(isGracefulShutdownInProgress()).toBe(false);
  });

  it("setGracefulShutdownInProgress(true) flips the flag", () => {
    setGracefulShutdownInProgress(true);
    expect(isGracefulShutdownInProgress()).toBe(true);
  });

  it("setSpawnedPid resets graceful flag to false", () => {
    setGracefulShutdownInProgress(true);
    setSpawnedPid(12345);
    expect(isGracefulShutdownInProgress()).toBe(false);
  });
});

describe("makeServerWatchdog", () => {
  beforeEach(() => {
    setGracefulShutdownInProgress(false);
  });

  it("graceful exit: logs only, does not call onCrash", () => {
    const log = vi.fn();
    const onCrash = vi.fn();
    const watchdog = makeServerWatchdog({
      isGraceful: () => true,
      log,
      onCrash,
    });

    watchdog(0, null);

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]![0]).toContain("gracefully");
    expect(onCrash).not.toHaveBeenCalled();
  });

  it("unexpected exit: logs and calls onCrash with code + signal", () => {
    const log = vi.fn();
    const onCrash = vi.fn();
    const watchdog = makeServerWatchdog({
      isGraceful: () => false,
      log,
      onCrash,
    });

    watchdog(1, "SIGTERM");

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]![0]).toContain("unexpectedly");
    expect(onCrash).toHaveBeenCalledOnce();
    expect(onCrash).toHaveBeenCalledWith(1, "SIGTERM");
  });

  it("unexpected exit with null code: still calls onCrash", () => {
    const log = vi.fn();
    const onCrash = vi.fn();
    const watchdog = makeServerWatchdog({
      isGraceful: () => false,
      log,
      onCrash,
    });

    watchdog(null, "SIGKILL");

    expect(onCrash).toHaveBeenCalledWith(null, "SIGKILL");
  });

  it("onCrash throws: swallowed, secondary failure logged", () => {
    const log = vi.fn();
    const onCrash = vi.fn().mockImplementation(() => {
      throw new Error("window already destroyed");
    });
    const watchdog = makeServerWatchdog({
      isGraceful: () => false,
      log,
      onCrash,
    });

    // Must not throw
    expect(() => watchdog(1, null)).not.toThrow();

    // Two log calls: crash message + secondary failure
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1]![0]).toContain("window already destroyed");
  });
});
