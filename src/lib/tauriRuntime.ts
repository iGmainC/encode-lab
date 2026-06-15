/**
 * 判断当前前端是否运行在 Tauri 宿主内。
 * @returns true 表示可以安全调用 Tauri window/event/dialog 等宿主 API
 */
export function isTauriRuntime() {
  // 普通浏览器预览没有 __TAURI_INTERNALS__，直接调用部分 Tauri API 会导致首屏崩溃。
  return "__TAURI_INTERNALS__" in window;
}
