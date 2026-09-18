const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://rnfhcwoqcrdoevabtjku.supabase.co'
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

export type ExtractedIngredients = { ingredientText: string; readable: boolean; remaining?: number; closed?: boolean }

/** 같은 사진을 다시 보내지 않으려고 쓰는 값. 사진 자체는 어디에도 남지 않는다. */
export async function imageKey(base64: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base64)))
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

function publicKey(key: string) {
  if (key.startsWith('sb_publishable_')) return true
  try { return JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon' } catch { return false }
}

/** 사용자가 고른 영역. 0~1 비율이라 화면 크기와 무관하다. 없으면 사진 전체다. */
export type CropArea = { x: number; y: number; width: number; height: number }
const MAX_EDGE = 1600

function loadImage(uri: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('사진을 읽지 못했어요. 다른 사진을 골라주세요.'))
    image.src = uri
  })
}

/** 보낼 픽셀만 남긴다 — 자른 영역을 잘라내고, 긴 변을 1600px 로 줄여 JPEG 로 다시 그린다. */
export async function imageForExtraction(uri: string, crop?: CropArea) {
  const image = await loadImage(uri)
  const area = crop ?? { x: 0, y: 0, width: 1, height: 1 }
  const sx = Math.round(area.x * image.naturalWidth), sy = Math.round(area.y * image.naturalHeight)
  const sw = Math.max(1, Math.round(area.width * image.naturalWidth)), sh = Math.max(1, Math.round(area.height * image.naturalHeight))
  const scale = Math.min(1, MAX_EDGE / Math.max(sw, sh))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sw * scale)); canvas.height = Math.max(1, Math.round(sh * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('사진을 처리하지 못했어요. 다시 시도해 주세요.')
  context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  const dataUri = canvas.toDataURL('image/jpeg', 0.85)
  const base64 = dataUri.slice(dataUri.indexOf(',') + 1)
  // base64 는 3바이트를 4글자로 적는다.
  if (base64.length * 3 / 4 > MAX_IMAGE_BYTES) throw new Error('사진이 너무 커요. 원재료명 부분만 잘라서 보내주세요.')
  return { base64, mimeType: 'image/jpeg', preview: dataUri }
}

export async function extractIngredients(image: { base64: string; mimeType: string }, deviceId: string): Promise<ExtractedIngredients> {
  if (!SUPABASE_KEY || !publicKey(SUPABASE_KEY)) throw new Error('분석 서버의 공개 연결 정보가 설정되지 않았어요.')
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 70_000)
  try {
    const response = await fetch(new URL('/functions/v1/extract-ingredients', SUPABASE_URL), {
      method: 'POST', credentials: 'omit', signal: controller.signal,
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, deviceId }),
    })
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok || !data || typeof data !== 'object') {
      if (response.status === 404) throw new Error('분석 서버를 배포하는 중이에요. 잠시 후 다시 시도해 주세요.')
      // 한도·예산으로 막힌 경우는 화면에서 그대로 알린다.
      if (response.status === 429 && data && typeof data === 'object' && 'message' in data) {
        const limited = new Error(String((data as Record<string, unknown>).message))
        limited.name = (data as Record<string, unknown>).closed ? 'BudgetClosed' : 'DailyLimit'
        throw limited
      }
      const message = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string' ? data.message : '원재료를 읽지 못했어요. 사진을 다시 확인해 주세요.'
      throw new Error(message)
    }
    const value = data as Record<string, unknown>
    if (typeof value.ingredientText !== 'string' || typeof value.readable !== 'boolean' || value.ingredientText.length > 12_000) throw new Error('분석 결과 형식이 올바르지 않아요.')
    return { ingredientText: value.ingredientText, readable: value.readable, remaining: typeof value.remaining === 'number' ? value.remaining : undefined }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('분석 시간이 길어지고 있어요. 잠시 후 다시 시도해 주세요.')
    throw error
  } finally { window.clearTimeout(timer) }
}
