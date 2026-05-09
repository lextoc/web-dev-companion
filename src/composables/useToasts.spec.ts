import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeError, useToasts } from "./useToasts";

function installDeterministicToastIds() {
  let now = 1_000;
  let random = 0;

  vi.spyOn(Date, "now").mockImplementation(() => {
    now += 1;
    return now;
  });
  vi.spyOn(Math, "random").mockImplementation(() => {
    random += 0.01;
    return random;
  });
}

describe("useToasts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-09T12:00:00.000Z"));
    installDeterministicToastIds();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("normalizes unknown errors and clears the visible error message", () => {
    const toasts = useToasts();

    expect(normalizeError(new Error("Repository failed"))).toBe("Repository failed");
    expect(normalizeError("plain string")).toBe("Something went wrong.");

    toasts.showError(new Error("Could not load repository."));
    expect(toasts.errorMessage.value).toBe("Could not load repository.");

    toasts.clearError();
    expect(toasts.errorMessage.value).toBe("");
  });

  it("keeps the newest toast and activity items within their caps", () => {
    const toasts = useToasts();

    for (let index = 1; index <= 9; index += 1) {
      toasts.showAppFeedback(`Message ${index}`, index % 2 === 0 ? "info" : "success");
    }

    expect(toasts.appToasts.value.map((toast) => toast.message)).toEqual([
      "Message 9",
      "Message 8",
      "Message 7",
      "Message 6",
    ]);
    expect(toasts.activityItems.value.map((item) => item.message)).toEqual([
      "Message 9",
      "Message 8",
      "Message 7",
      "Message 6",
      "Message 5",
      "Message 4",
      "Message 3",
      "Message 2",
    ]);
    expect(toasts.activityItems.value[0]).toMatchObject({
      message: "Message 9",
      tone: "success",
    });
  });

  it("dismisses toasts after the timeout and supports hold/release", () => {
    const toasts = useToasts();

    toasts.showAppFeedback("Deploy finished.");
    const toastId = toasts.appToasts.value[0]?.id;

    expect(toastId).toBeTruthy();

    toasts.holdToast(toastId);
    vi.advanceTimersByTime(4_000);
    expect(toasts.appToasts.value).toHaveLength(1);

    toasts.releaseToast(toastId);
    vi.advanceTimersByTime(3_999);
    expect(toasts.appToasts.value).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(toasts.appToasts.value).toEqual([]);
  });

  it("cleans up timers without removing visible toasts", () => {
    const toasts = useToasts();

    toasts.showAppFeedback("Saved settings.", "info");
    toasts.cleanupToasts();
    vi.advanceTimersByTime(4_000);

    expect(toasts.appToasts.value).toHaveLength(1);
    expect(toasts.appToasts.value[0]).toMatchObject({
      message: "Saved settings.",
      tone: "info",
    });
  });
});
