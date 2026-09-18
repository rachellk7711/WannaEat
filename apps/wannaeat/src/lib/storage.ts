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
  async remove(key: string): Promise<void> {
    if (isNative) await Storage.removeItem(key)
    else window.localStorage.removeItem(key)
  },
}

export const DEVICE_KEY = 'wannaeat.device.v1'
export const READS_KEY = 'wannaeat.reads.v1'
export const PREFERENCES_KEY = 'wannaeat.criteria.v2'

/** 기기를 구분하는 임의의 값. 하루 사용 횟수를 세는 데만 쓰고, 사람을 가리키지 않는다. */
export async function deviceId() {
  const stored = await deviceStorage.get(DEVICE_KEY)
  if (stored && /^[A-Za-z0-9-]{8,64}$/.test(stored)) return stored
  const created = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
  await deviceStorage.set(DEVICE_KEY, created)
  return created
}
export const LEGACY_KEY = 'wannaeat.criteria.v1'
