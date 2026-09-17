const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://rnfhcwoqcrdoevabtjku.supabase.co'
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

export type ExtractedIngredients = { ingredientText: string; readable: boolean }

function publicKey(key: string) {
  if (key.startsWith('sb_publishable_')) return true
  try { return JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon' } catch { return false }
}

export async function imageForExtraction(uri: string) {
  const response = await fetch(uri)
  const blob = await response.blob()
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) throw new Error('JPG, PNG 또는 WebP 이미지를 골라주세요.')
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('분석할 사진은 4MB 이하로 골라주세요. 원재료명 부분을 가까이 찍으면 더 잘 읽어요.')
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('사진을 읽지 못했어요.'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') reject(new Error('사진을 읽지 못했어요.'))
      else resolve(reader.result.slice(reader.result.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
  return { base64, mimeType: blob.type }
}

export async function extractIngredients(image: { base64: string; mimeType: string }): Promise<ExtractedIngredients> {
  if (!SUPABASE_KEY || !publicKey(SUPABASE_KEY)) throw new Error('분석 서버의 공개 연결 정보가 설정되지 않았어요.')
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 70_000)
  try {
    const response = await fetch(new URL('/functions/v1/extract-ingredients', SUPABASE_URL), {
      method: 'POST', credentials: 'omit', signal: controller.signal,
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
    })
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok || !data || typeof data !== 'object') {
      if (response.status === 404) throw new Error('분석 서버를 배포하는 중이에요. 잠시 후 다시 시도해 주세요.')
      const message = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string' ? data.message : '원재료를 읽지 못했어요. 사진을 다시 확인해 주세요.'
      throw new Error(message)
    }
    const value = data as Record<string, unknown>
    if (typeof value.ingredientText !== 'string' || typeof value.readable !== 'boolean' || value.ingredientText.length > 12_000) throw new Error('분석 결과 형식이 올바르지 않아요.')
    return { ingredientText: value.ingredientText, readable: value.readable }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('분석 시간이 길어지고 있어요. 잠시 후 다시 시도해 주세요.')
    throw error
  } finally { window.clearTimeout(timer) }
}
