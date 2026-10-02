// 원산지 낱말 — 라벨의 `국산` · `미국산` · `외국산(미국, 중국 등)` 을 알아본다.
// 판정 규칙(analysis.ts)과 원산지 모드(origin.ts)가 함께 쓴다. 다른 모듈을 가져오지 않는다.

/** 고를 수 있는 원산지. 21장의 실제 라벨과 수입이 많은 나라로 정했다(2026-10-01). */
export const ORIGIN_CHOICES = [
  { id: 'origin_foreign', name: '외국산 전체', what: '국산이 아닌 원산지가 하나라도 적혀 있으면 찾아요. 나라 이름 없이 외국산·수입산이라고만 적힌 것도 찾아요.' },
  { id: 'origin_us', name: '미국산', country: '미국' },
  { id: 'origin_cn', name: '중국산', country: '중국' },
  { id: 'origin_jp', name: '일본산', country: '일본' },
  { id: 'origin_au', name: '호주산', country: '호주' },
  { id: 'origin_th', name: '태국산', country: '태국' },
  { id: 'origin_vn', name: '베트남산', country: '베트남' },
  { id: 'origin_my', name: '말레이시아산', country: '말레이시아' },
  { id: 'origin_pl', name: '폴란드산', country: '폴란드' },
  { id: 'origin_ru', name: '러시아산', country: '러시아' },
  { id: 'origin_ca', name: '캐나다산', country: '캐나다' },
  { id: 'origin_br', name: '브라질산', country: '브라질' },
  { id: 'origin_cl', name: '칠레산', country: '칠레' },
  { id: 'origin_nz', name: '뉴질랜드산', country: '뉴질랜드' },
  { id: 'origin_in', name: '인도산', country: '인도' },
] as const satisfies readonly { id: string; name: string; country?: string; what?: string }[]
export const ORIGIN_IDS: ReadonlySet<string> = new Set(ORIGIN_CHOICES.map(choice => choice.id))

// 같은 나라의 다른 이름. 왼쪽이 화면에 쓰는 이름이다.
const COUNTRY_ALIASES: Record<string, string[]> = {
  미국: ['미국', 'usa'], 중국: ['중국'], 일본: ['일본'], 호주: ['호주', '오스트레일리아'], 태국: ['태국'], 베트남: ['베트남'],
  말레이시아: ['말레이시아'], 폴란드: ['폴란드'], 러시아: ['러시아'], 캐나다: ['캐나다'], 브라질: ['브라질'], 칠레: ['칠레'],
  뉴질랜드: ['뉴질랜드'], 인도: ['인도'], 인도네시아: ['인도네시아'], 필리핀: ['필리핀'], 이탈리아: ['이탈리아'], 스페인: ['스페인'],
  프랑스: ['프랑스'], 독일: ['독일'], 네덜란드: ['네덜란드'], 덴마크: ['덴마크'], 벨기에: ['벨기에'], 영국: ['영국'], 아일랜드: ['아일랜드'],
  헝가리: ['헝가리'], 그리스: ['그리스'], 오스트리아: ['오스트리아'], 노르웨이: ['노르웨이'], 스웨덴: ['스웨덴'], 핀란드: ['핀란드'],
  스위스: ['스위스'], 포르투갈: ['포르투갈'], 아르헨티나: ['아르헨티나'], 페루: ['페루'], 멕시코: ['멕시코'], 파라과이: ['파라과이'],
  우루과이: ['우루과이'], 에콰도르: ['에콰도르'], 콜롬비아: ['콜롬비아'], 과테말라: ['과테말라'], 모로코: ['모로코'], 나이지리아: ['나이지리아'],
  이집트: ['이집트'], 튀르키예: ['튀르키예', '터키'], 이스라엘: ['이스라엘'], 이란: ['이란'], 파키스탄: ['파키스탄'], 미얀마: ['미얀마'],
  대만: ['대만'], 싱가포르: ['싱가포르'], 우크라이나: ['우크라이나'], 카자흐스탄: ['카자흐스탄'], 남아공: ['남아공', '남아프리카공화국'],
  스리랑카: ['스리랑카'], 캄보디아: ['캄보디아'], 라오스: ['라오스'], 몽골: ['몽골'], 에티오피아: ['에티오피아'], 케냐: ['케냐'], 탄자니아: ['탄자니아'],
}
const DOMESTIC = ['국산', '국내산', '한국산', '대한민국산']
const FOREIGN = ['외국산', '수입산']

export type OriginWord = { country?: string; domestic?: boolean; foreign?: boolean; label: string }
// `○○산` 낱말. 긴 것부터 맞춘다 — `중국산` 이 `국산` 으로, `인도네시아산` 이 `인도산` 으로 읽히지 않게.
const SUFFIXED: [string, OriginWord][] = [
  ...DOMESTIC.map(word => [word, { domestic: true, label: word }] as [string, OriginWord]),
  ...FOREIGN.map(word => [word, { foreign: true, label: word }] as [string, OriginWord]),
  ...Object.entries(COUNTRY_ALIASES).flatMap(([country, aliases]) => aliases.map(alias => [`${alias}산`, { country, foreign: true, label: `${country}산` }] as [string, OriginWord])),
].sort((a, b) => b[0].length - a[0].length)
const BARE = new Map(Object.entries(COUNTRY_ALIASES).flatMap(([country, aliases]) => aliases.map(alias => [alias, country] as const)))

const dropEtc = (token: string) => token.replace(/등$/, '')

/** 낱말 전체가 원산지인가 — `국산` · `미국산` · `외국산` · `베트남등`(bare 는 bareCountry 로 따로 본다). */
export function originWord(token: string): OriginWord | null {
  const word = dropEtc(token)
  return SUFFIXED.find(([form]) => form === word)?.[1] ?? null
}

/** 원산지 칸이나 `외국산(…)` 안에서만 쓰는 나라 이름 — `미국` · `베트남 등`. 다른 곳의 `이집트콩` 은 원산지가 아니다. */
export function bareCountry(token: string) {
  return BARE.get(dropEtc(token)) ?? null
}

/** 원재료와 붙어 쓴 원산지 — `대두외국산`(대두-외국산) · `영국산위스키`. 원재료 이름을 함께 돌려준다. */
export function attachedOrigin(token: string): { word: OriginWord; ingredient: string } | null {
  const word = dropEtc(token)
  for (const [form, origin] of SUFFIXED) {
    if (word.length > form.length && word.endsWith(form)) return { word: origin, ingredient: word.slice(0, -form.length) }
  }
  for (const [form, origin] of SUFFIXED) {
    // `국산콩` 처럼 앞에 붙은 것. 나라 이름이 이어지는 `국산…` 과 헷갈리지 않게 낱말 경계는 따로 두지 않는다.
    if (word.length > form.length && word.startsWith(form)) return { word: origin, ingredient: word.slice(form.length) }
  }
  return null
}

/** 판정 규칙이 원산지 낱말을 원재료로 다루지 않게 한다(오독 보정 등). */
export function isOriginToken(token: string) {
  return !!originWord(token) || !!attachedOrigin(token)
}

/** 원산지 칸 문자열에서 나라를 찾는다 — `태국` · `원산지: 이탈리아` · `별도 표기`(없음). */
export function countriesIn(text: string) {
  const found: OriginWord[] = []
  for (const piece of text.split(/[,，、/·\s]+/).map(part => part.replace(/[()[\]{}:：]/g, '').trim()).filter(Boolean)) {
    const word = originWord(piece.toLocaleLowerCase())
    const bare = bareCountry(piece.toLocaleLowerCase())
    if (word) found.push(word)
    else if (bare) found.push({ country: bare, foreign: true, label: bare })
  }
  return found
}
