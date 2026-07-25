import { describe, expect, test } from "bun:test";
import { requestConfirmation } from "./confirmation";

describe("request confirmation", () => {
  test("waits for the asynchronous Tauri confirmation result", async () => {
    let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
    let settled = false;
    const result = requestConfirmation(
      "delete record",
      () => new Promise<boolean>((resolve) => {
        resolveConfirmation = resolve;
      }),
    );
    void result.then(() => {
      settled = true;
    });

    // 确认框仍在等待用户选择时，调用方不能进入删除流程。
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveConfirmation?.(false);
    expect(await result).toBe(false);
  });

  test("preserves the synchronous browser confirmation result", async () => {
    expect(await requestConfirmation("delete record", () => true)).toBe(true);
    expect(await requestConfirmation("delete record", () => false)).toBe(false);
  });
});
