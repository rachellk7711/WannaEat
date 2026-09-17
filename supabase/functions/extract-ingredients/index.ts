// This function extracts printed ingredient text only. The fixed matching rules
// run in the app after the user has reviewed and corrected that text.
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const maxBase64Length = Math.ceil(4 * 1024 * 1024 * 4 / 3) + 8
const windows = new Map<string, number[]>()

function cors(request: Request) {
  const origin = request.headers.get('origin')
  try {
    const host = origin ? new URL(origin).hostname : ''
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.toss.im')) return { 'Access-Control-Allow-Origin': origin!, Vary: 'Origin' }
  } catch { /* The request is rejected below when CORS is needed. */ }
  return { Vary: 'Origin' }
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(request), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
}

function allowedOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return true // Native WebView requests may omit Origin.
  return Boolean(cors(request)['Access-Control-Allow-Origin'])
}

function rateLimited(request: Request) {
  const address = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'
  const now = Date.now(), threshold = now - 10 * 60_000
  const recent = (windows.get(address) || []).filter(time => time > threshold)
  if (recent.length >= 4) return true
  recent.push(now); windows.set(address, recent)
  return false
}

function outputText(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const object = value as Record<string, unknown>
  for (const key of ['output_text', 'text']) if (typeof object[key] === 'string' && object[key].trim()) return object[key].trim()
  for (const child of Object.values(object)) {
    if (Array.isArray(child)) for (const item of child) { const found = outputText(item); if (found) return found }
    else if (child && typeof child === 'object') { const found = outputText(child); if (found) return found }
  }
  return null
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: { ...cors(request), 'Access-Control-Allow-Headers': 'apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '86400' } })
  if (request.method !== 'POST') return json(request, { message: 'POST 요청만 사용할 수 있어요.' }, 405)
  if (!allowedOrigin(request)) return json(request, { message: '허용되지 않은 출처예요.' }, 403)
  if (rateLimited(request)) return json(request, { message: '잠시 후 다시 시도해 주세요.' }, 429)
  try {
    const body = await request.json()
    const image = body?.image
    if (!image || typeof image.base64 !== 'string' || typeof image.mimeType !== 'string' || !allowedMimeTypes.has(image.mimeType) || image.base64.length === 0 || image.base64.length > maxBase64Length || !/^[A-Za-z0-9+/=]+$/.test(image.base64)) return json(request, { message: '사진 형식이 올바르지 않아요.' }, 400)
    const key = Deno.env.get('GEMINI_API_KEY')
    if (!key) return json(request, { message: '분석 서버가 아직 준비되지 않았어요.' }, 503)
    const prompt = '사진에서 제품의 원재료명 또는 원재료 표시 부분만 그대로 읽어라. 제품명, 영양성분, 광고 문구, 알레르기 안내, 추측한 성분은 포함하지 마라. 원재료를 읽을 수 없으면 readable을 false로 하고 ingredientText는 빈 문자열로 반환하라. 쉼표로 구분된 원문을 한 줄로 보존하라.'
    const gemini = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-3.6-flash', input: [{ type: 'text', text: prompt }, { type: 'image', data: image.base64, mime_type: image.mimeType }], response_format: { type: 'text', mime_type: 'application/json', schema: { type: 'object', properties: { readable: { type: 'boolean' }, ingredientText: { type: 'string' } }, required: ['readable', 'ingredientText'] } } }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!gemini.ok) return json(request, { message: '원재료 읽기 서비스가 응답하지 않았어요. 잠시 후 다시 시도해 주세요.' }, 502)
    const parsed = outputText(await gemini.json())
    if (!parsed) return json(request, { message: '원재료를 읽지 못했어요. 원재료명 부분이 선명한 사진을 골라주세요.' }, 422)
    const result = JSON.parse(parsed)
    if (!result || typeof result.readable !== 'boolean' || typeof result.ingredientText !== 'string' || result.ingredientText.length > 12_000) return json(request, { message: '원재료 읽기 결과가 올바르지 않아요.' }, 502)
    return json(request, { readable: result.readable, ingredientText: result.ingredientText.replace(/[\r\n]+/g, ' ').trim() })
  } catch (error) {
    if (error instanceof SyntaxError) return json(request, { message: '사진 요청을 읽지 못했어요.' }, 400)
    return json(request, { message: '원재료를 읽지 못했어요. 잠시 후 다시 시도해 주세요.' }, 500)
  }
})
