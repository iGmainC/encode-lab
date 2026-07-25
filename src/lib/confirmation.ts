/** 浏览器与桌面宿主允许的确认函数返回值。 */
type ConfirmationHandler = (message: string) => boolean | Promise<boolean>;

/**
 * 等待用户明确完成确认后再返回结果。
 * @param message 确认框展示文案
 * @param handler 确认框实现；默认使用当前运行时的 window.confirm
 * @returns 只有用户明确确认时返回 true
 */
export async function requestConfirmation(
  message: string,
  handler: ConfirmationHandler = (value) => window.confirm(value),
) {
  // Tauri dialog 插件会把 window.confirm 覆写为异步函数，必须统一等待真实选择结果。
  return (await handler(message)) === true;
}
