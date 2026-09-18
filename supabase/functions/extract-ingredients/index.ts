// This function extracts printed ingredient text only. The fixed matching rules
// run in the app after the user has reviewed and corrected that text.
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const maxBase64Length = Math.ceil(4 * 1024 * 1024 * 4 / 3) + 8
const windows = new Map<string, number[]>()
// Flash-Lite reads Korean ingredient lists as well as the larger models here and costs the least.
// The bigger models only stand by for the day Flash-Lite is unavailable.
const models = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.6-flash']
// 실제 라벨 사진(쇼핑 캡처)에서 LOW 는 `벌꿀분말` 을 `별첨분말` 로 잘못 읽었다. MEDIUM 은 제대로 읽는다.
// 값은 한 장에 0.11원 더 드는 정도라, 거짓 안심을 막는 쪽을 택한다. 빈 답이 오면 기본 해상도로 한 번 더 본다.
const resolutions: (string | undefined)[] = ['MEDIA_RESOLUTION_MEDIUM', undefined]
// 무료로 배포하는 서비스라 월 예산이 상한이다. 상한에 닿으면 기능을 닫고 다시 준비한다(2026-09-18 결정).
const DEVICE_DAILY_LIMIT = 10
const MONTHLY_BUDGET_MICROS = 13_800_000 // 약 2만원 (환율 1,450원)
const INPUT_PRICE_MICROS = 250_000 // gemini-3.1-flash-lite, 100만 토큰당 $0.25
const OUTPUT_PRICE_MICROS = 1_500_000 // 100만 토큰당 $1.50

async function deviceHash(deviceId: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(deviceId))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function usage(path: string, body: Record<string, unknown>) {
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return Promise.reject(new Error('usage store not configured'))
  return fetch(`${url}/rest/v1/rpc/${path}`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
  })
}

function cors(request: Request) {
  const origin = request.headers.get('origin')
  try {
    const host = origin ? new URL(origin).hostname : ''
    // 사설 IP 는 같은 집 안의 휴대폰으로 시험할 때 쓴다. 바깥에서는 닿지 않는 주소다.
    const lan = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
    if (host === 'localhost' || host === '127.0.0.1' || lan || host.endsWith('.toss.im')) return { 'Access-Control-Allow-Origin': origin!, Vary: 'Origin' }
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
    if (typeof body?.deviceId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(body.deviceId)) return json(request, { message: '기기 정보를 확인하지 못했어요. 앱을 다시 열어 주세요.' }, 400)
    // 사용량을 셀 수 없으면 보내지 않는다. 예산을 넘기는 쪽보다 잠시 멈추는 쪽이 낫다.
    let remaining = DEVICE_DAILY_LIMIT
    try {
      const reserved = await usage('reserve_ocr_call', {
        p_device_hash: await deviceHash(body.deviceId), p_device_daily_limit: DEVICE_DAILY_LIMIT,
        p_monthly_budget_micros: MONTHLY_BUDGET_MICROS, p_input_price_micros: INPUT_PRICE_MICROS, p_output_price_micros: OUTPUT_PRICE_MICROS,
      })
      if (!reserved.ok) throw new Error(`reserve HTTP ${reserved.status}`)
      const verdict = String(await reserved.json() ?? '')
      if (verdict === 'budget') return json(request, { message: '이번 달 무료 분석이 모두 소진됐어요. 다음 달에 다시 열려요.', closed: true }, 429)
      if (verdict.startsWith('device')) return json(request, { message: `오늘은 여기까지예요. 하루 ${DEVICE_DAILY_LIMIT}장까지 확인할 수 있어요.`, remaining: 0 }, 429)
      if (!verdict.startsWith('ok')) throw new Error(`unexpected verdict ${verdict}`)
      remaining = Number(verdict.split(':')[1] ?? DEVICE_DAILY_LIMIT)
    } catch (error) {
      console.error('usage store unavailable', error instanceof Error ? error.message : error)
      return json(request, { message: '사진 읽기를 잠시 멈췄어요. 잠시 후 다시 시도해 주세요.' }, 503)
    }
    const prompt = '사진에서 제품의 원재료명 또는 원재료 표시 부분만 그대로 읽어라. 제품명, 영양성분, 광고 문구, 알레르기 안내, 추측한 성분은 포함하지 마라. 원재료를 읽을 수 없으면 readable을 false로 하고 ingredientText는 빈 문자열로 반환하라. 쉼표로 구분된 원문을 한 줄로 보존하라.'
    const ask = (model: string, mediaResolution?: string) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: image.mimeType, data: image.base64 } }] }],
        generationConfig: { temperature: 0, ...(mediaResolution ? { mediaResolution } : {}), responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { readable: { type: 'BOOLEAN' }, ingredientText: { type: 'STRING' } }, required: ['readable', 'ingredientText'] } },
      }),
      signal: AbortSignal.timeout(60_000),
    })
    // One model's daily quota running out must not take the feature down.
    let gemini: Response | undefined
    let text: string | null = null
    let lastUsage: { input: number; output: number } | null = null
    for (const model of models) {
      for (const resolution of resolutions) {
        gemini = await ask(model, resolution)
        if (!gemini.ok) break
        const answer = await gemini.json()
        const counted = answer?.usageMetadata
        if (counted) lastUsage = {
          input: (lastUsage?.input ?? 0) + Number(counted.promptTokenCount ?? 0),
          output: (lastUsage?.output ?? 0) + Number(counted.candidatesTokenCount ?? 0) + Number(counted.thoughtsTokenCount ?? 0),
        }
        text = outputText(answer)
        // 읽어내지 못했으면 한 번만 더 자세히 본다. 대부분은 첫 번째에서 끝난다.
        if (text && (JSON.parse(text).ingredientText || '').trim()) break
      }
      if ((gemini?.ok && text) || ![404, 429, 500, 503].includes(gemini?.status ?? 0)) break
    }
    if (!gemini || !gemini.ok) {
      const status = gemini?.status
      if (status === 429) return json(request, { message: '오늘 사진 읽기 한도를 다 썼어요. 잠시 후 다시 시도해 주세요.' }, 429)
      if (status === 401 || status === 403) return json(request, { message: '분석 서버 설정을 확인하고 있어요. 잠시 후 다시 시도해 주세요.' }, 503)
      if (status === 404) return json(request, { message: '사진 읽기 모델을 준비하고 있어요. 잠시 후 다시 시도해 주세요.' }, 503)
      return json(request, { message: '원재료 읽기 서비스가 응답하지 않았어요. 잠시 후 다시 시도해 주세요.' }, 502)
    }
    // 실제로 쓴 토큰을 적어 둔다. 예산은 이 값으로 계산한다.
    if (lastUsage) void usage('record_ocr_tokens', { p_input_tokens: lastUsage.input, p_output_tokens: lastUsage.output }).catch(() => {})
    if (!text) return json(request, { message: '원재료를 읽지 못했어요. 원재료명 부분이 선명한 사진을 골라주세요.' }, 422)
    const result = JSON.parse(text)
    if (!result || typeof result.readable !== 'boolean' || typeof result.ingredientText !== 'string' || result.ingredientText.length > 12_000) return json(request, { message: '원재료 읽기 결과가 올바르지 않아요.' }, 502)
    return json(request, { readable: result.readable, remaining, ingredientText: result.ingredientText.replace(/[\r\n]+/g, ' ').trim() })
  } catch (error) {
    if (error instanceof SyntaxError) return json(request, { message: '사진 요청을 읽지 못했어요.' }, 400)
    return json(request, { message: '원재료를 읽지 못했어요. 잠시 후 다시 시도해 주세요.' }, 500)
  }
})
