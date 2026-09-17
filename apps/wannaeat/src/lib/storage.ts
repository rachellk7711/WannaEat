import { Storage } from '@apps-in-toss/web-framework'

// The bridge is provided by the native WebView. Browsers use their own origin's
// localStorage; a native storage failure must never silently switch stores.
export const isNative = typeof (window as unknown as { ReactNativeWebView?: { postMessage?: unknown } }).ReactNativeWebView?.postMessage === 'function'

export const deviceStorage = {
  async get(key: string): Promise<string | null> {
    return isNative ? Storage.getItem(key) : window.localStorage.getItem(key)
  },
  async set(key: string, value: string): Promise<void> {
    if (isNative) await Storage.setItem(key, value)
    else window.localStorage.setItem(key, value)
  },
}

export const PREFERENCES_KEY = 'wannaeat.criteria.v2'
export const LEGACY_KEY = 'wannaeat.criteria.v1'
