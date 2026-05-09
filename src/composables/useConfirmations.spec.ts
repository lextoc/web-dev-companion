import { describe, expect, it } from "vitest";
import { useConfirmations } from "./useConfirmations";

describe("useConfirmations", () => {
  it("opens a confirmation dialog and resolves true when confirmed", async () => {
    const confirmations = useConfirmations();
    const confirmationPromise = confirmations.confirmAction({
      title: "Remove branch",
      message: "Remove feature branch?",
      confirmLabel: "Remove",
      danger: true,
    });

    expect(confirmations.confirmationDialog.value).toMatchObject({
      title: "Remove branch",
      message: "Remove feature branch?",
      confirmLabel: "Remove",
      danger: true,
    });

    confirmations.closeConfirmation(true);

    await expect(confirmationPromise).resolves.toBe(true);
    expect(confirmations.confirmationDialog.value).toBeNull();
  });

  it("resolves false when dismissed and ignores close calls without a dialog", async () => {
    const confirmations = useConfirmations();

    confirmations.closeConfirmation(true);

    const confirmationPromise = confirmations.confirmAction({
      title: "Git reset",
      message: "Discard tracked changes?",
      confirmLabel: "Git reset",
    });

    confirmations.closeConfirmation(false);
    confirmations.closeConfirmation(true);

    await expect(confirmationPromise).resolves.toBe(false);
    expect(confirmations.confirmationDialog.value).toBeNull();
  });
});
