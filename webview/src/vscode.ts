import type { WebviewMessage } from './types';

// ============================================================================
// VS Code API Interface
// ============================================================================

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

// Declare the global function provided by VS Code
declare function acquireVsCodeApi(): VsCodeApi;

// ============================================================================
// Singleton VS Code API instance
// ============================================================================

let vscodeApi: VsCodeApi | null = null;

/**
 * Get the VS Code API instance. Safe to call multiple times.
 * Returns null if not running in a VS Code webview (e.g., during development).
 */
export function getVsCodeApi(): VsCodeApi | null {
  if (vscodeApi) return vscodeApi;
  
  try {
    // acquireVsCodeApi can only be called once
    vscodeApi = acquireVsCodeApi();
    return vscodeApi;
  } catch {
    // Not running in VS Code webview (dev mode)
    console.warn('VS Code API not available. Running in standalone mode.');
    return null;
  }
}

/**
 * Send a message to the VS Code extension.
 * Silently no-ops if not in a webview context.
 */
export function postMessage(message: WebviewMessage): void {
  const api = getVsCodeApi();
  if (api) {
    api.postMessage(message);
  } else {
    console.log('[DEV] Would post message:', message);
  }
}

/**
 * Notify the extension that the webview is ready to receive messages.
 */
export function notifyReady(): void {
  postMessage({ type: 'WEBVIEW_READY' });
}
