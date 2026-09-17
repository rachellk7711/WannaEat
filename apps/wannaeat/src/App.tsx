import { useEffect, useRef, useState } from 'react'
import { Device, fetchAlbumItems, graniteEvent, OpenCameraPermissionError } from '@apps-in-toss/web-framework'
import { allCriteria, effectiveSelections, parsePreferences, validSelection, strengthLabels } from './domain/catalog.ts'
import type { Preferences, Selection } from './domain/catalog.ts'
import { analyzeIngredients } from './domain/analysis.ts'
import { bundledRelease, bundledRules, loadCatalog } from './lib/catalog-loader.ts'
import { deviceStorage, isNative, LEGACY_KEY, PREFERENCES_KEY } from './lib/storage.ts'
import { extractIngredients, imageForExtraction } from './lib/extract.ts'
import CriteriaEditor from './components/CriteriaEditor.tsx'
import { BrandMark, Icon, LabelArt } from './components/Brand.tsx'
import './App.css'

type Page = 'home' | 'criteria' | 'image' | 'review' | 'result'
const readPage = (): Page => location.hash === '#criteria' ? 'criteria' : location.hash === '#image' ? 'image' : location.hash === '#review' ? 'review' : location.hash === '#result' ? 'result' : 'home'

function App() {
  const [page, setPage] = useState<Page>(readPage)
  const [release, setRelease] = useState(bundledRelease)
  const [rules, setRules] = useState(bundledRules)
  const [saved, setSaved] = useState<Preferences>({ rulesetVersion: bundledRelease.rulesetVersion, selections: [] })
  const [draft, setDraft] = useState<Selection[]>([])
  const [busy, setBusy] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [readFailed, setReadFailed] = useState(false)
  const [review, setReview] = useState('')
  const [message, setMessage] = useState('')
  const oldRaw = useRef<string | null>(null)
  const [imageUri, setImageUri] = useState<string | null>(null)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageMessage, setImageMessage] = useState('')
  const [consented, setConsented] = useState(false)
  const [extractBusy, setExtractBusy] = useState(false)
  const [ingredientText, setIngredientText] = useState('')
  const [analysisMessage, setAnalysisMessage] = useState('')
  const [analysis, setAnalysis] = useState<ReturnType<typeof analyzeIngredients> | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const heading = useRef<HTMLDivElement>(null)
  const catalog = release.catalog
  const effective = effectiveSelections(catalog, saved.selections)
  const selected = allCriteria(catalog).filter(c => effective.has(c.id))
  const avoid = [...effective.values()].filter(strength => strength === 'avoid').length

  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        const [{ release: current, rules: currentRules }, raw, legacy] = await Promise.all([loadCatalog(), deviceStorage.get(PREFERENCES_KEY), deviceStorage.get(LEGACY_KEY)])
        if (!active) return
        setRelease(current)
        setRules(currentRules)
        let prefs: Preferences = { rulesetVersion: current.rulesetVersion, selections: [] }
        oldRaw.current = raw
        if (raw) {
          try {
            prefs = parsePreferences(JSON.parse(raw))
            const missing = prefs.selections.filter(row => !validSelection(current.catalog, row))
            if (prefs.rulesetVersion !== current.rulesetVersion || missing.length) setReview(`기준 목록이 업데이트됐어요. 전체 선택에 포함되는 항목과 개별 설정을 확인한 뒤 저장해 주세요.${missing.length ? ` 현재 목록에서 사용할 수 없는 항목: ${missing.map(row => row.id).join(', ')}. 저장하면 이 항목은 제외돼요.` : ''}`)
          } catch { setReview('이전에 저장한 기준을 읽을 수 없어요. 기준을 다시 골라 저장해 주세요. 기존 기록은 별도로 보관해요.') }
        } else if (legacy) setReview('예전 이름 기반 설정을 새 기준으로 바꿔주세요. 피해요 / 알려만줘요를 직접 고른 뒤 저장해 주세요. 예전 기록은 유지돼요.')
        setSaved(prefs)
        setDraft(prefs.selections.filter(row => validSelection(current.catalog, row)))
      } catch {
        if (active) { setReadFailed(true); setMessage('저장된 기준을 불러오지 못했어요. 다시 불러와 주세요.') }
      } finally { if (active) { setBusy(false); setLoaded(true) } }
    }
    void initialize()
    return () => { active = false }
  }, [])

  useEffect(() => {
    const update = () => { setPage(readPage()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    if (!isNative || page === 'home') return
    const goHome = () => { location.hash = ''; setPage('home') }
    const offBack = graniteEvent.addEventListener('backEvent', { onEvent: goHome })
    const offHome = graniteEvent.addEventListener('homeEvent', { onEvent: goHome })
    return () => { offBack(); offHome() }
  }, [page])

  useEffect(() => () => { if (imageUri?.startsWith('blob:')) URL.revokeObjectURL(imageUri) }, [imageUri])

  function go(next: Page) {
    setMessage('')
    if (next === 'criteria') setDraft(saved.selections.filter(row => validSelection(catalog, row)))
    // oxlint-disable-next-line react/immutability -- hash routing is browser navigation state.
    location.hash = next === 'home' ? '' : next
    setPage(next)
    window.scrollTo(0, 0)
  }

  async function readPhoto() {
    if (!imageUri || !consented || extractBusy) return
    setExtractBusy(true)
    setAnalysisMessage('')
    try {
      const image = await imageForExtraction(imageUri)
      const extracted = await extractIngredients(image)
      if (!extracted.readable || !extracted.ingredientText.trim()) throw new Error('원재료를 읽지 못했어요. 원재료명 부분이 선명한 사진을 골라주세요.')
      setIngredientText(extracted.ingredientText)
      go('review')
    } catch (error) { setAnalysisMessage(error instanceof Error ? error.message : '원재료를 읽지 못했어요. 다시 시도해 주세요.') }
    finally { setExtractBusy(false) }
  }

  function compareIngredients() {
    if (!ingredientText.trim()) { setAnalysisMessage('읽은 원재료를 입력해 주세요.'); return }
    if (release.rulesetVersion !== rules.rulesetVersion) { setAnalysisMessage('기준 목록과 판정 규칙의 버전이 맞지 않아요. 목록을 다시 불러온 뒤 시도해 주세요.'); return }
    setAnalysis(analyzeIngredients(ingredientText, catalog, effective, rules))
    setAnalysisMessage('')
    go('result')
  }

  async function save() {
    if (busy || readFailed) return
    setBusy(true)
    setMessage('')
    try {
      const prefs = parsePreferences({ rulesetVersion: release.rulesetVersion, selections: draft })
      if (prefs.selections.some(row => !validSelection(catalog, row))) throw new Error('Invalid selection')
      if (review && oldRaw.current) await deviceStorage.set(`${PREFERENCES_KEY}.previous`, oldRaw.current)
      const raw = JSON.stringify(prefs)
      await deviceStorage.set(PREFERENCES_KEY, raw)
      oldRaw.current = raw
      setSaved(prefs)
      setReview('')
      go('home')
      setMessage('내 기준을 저장했어요.')
    } catch { setMessage('저장하지 못했어요. 선택은 그대로 두었으니 다시 시도해 주세요.') }
    finally { setBusy(false) }
  }

  function imageSource(uri: string) { return /^(data:|blob:|https?:)/.test(uri) ? uri : `data:image/jpeg;base64,${uri}` }
  async function pickImage(camera = false) {
    if (!isNative) { (camera ? cameraInput : fileInput).current?.click(); return }
    setImageBusy(true)
    setImageMessage('')
    try {
      if (camera) {
        const photo = await Device.openCamera({ base64: true, maxWidth: 1600 })
        setPhoto(imageSource(photo.dataUri))
      } else {
        const items = await fetchAlbumItems({ types: ['PHOTO'], maxCount: 1, maxWidth: 1600, base64: true })
        if (items[0]) setPhoto(imageSource(items[0].dataUri))
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (!['CANCELED', 'CANCELLED', 'USER_CANCELLED'].includes(code)) setImageMessage(error instanceof OpenCameraPermissionError || code === 'NOT_ALLOWED' ? '사진 접근 권한을 확인해 주세요.' : '사진을 불러오지 못했어요. 다시 선택해 주세요.')
    } finally { setImageBusy(false) }
  }

  function setPhoto(uri: string) {
    setImageMessage('')
    setAnalysisMessage('')
    setConsented(false)
    setIngredientText('')
    setAnalysis(null)
    setImageUri(uri)
  }

  function localPhoto(file?: File) {
    if (!file) return
    if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) { setImageMessage('20MB 이하의 이미지 파일을 골라주세요.'); return }
    setPhoto(URL.createObjectURL(file))
  }

  return <main className="app">
    {!isNative && <header className="topbar">{page !== 'home' ? <button className="icon-button" type="button" onClick={() => go('home')} aria-label="홈으로 돌아가기"><Icon name="back" /></button> : <BrandMark />}<span className="brand">알고먹을래?</span><span className="topbar-dot" /></header>}
    <div className={`content page-${page}`} ref={heading} tabIndex={-1}>
      {message && <div className="notice" role="status">{message}{readFailed && <button className="text-button" type="button" onClick={() => location.reload()}>다시 불러오기</button>}</div>}
      {page === 'home' && <>
        <section className="intro"><span className="eyebrow"><span className="tiny-dot" /> 나를 위한 식품 선택</span><h1>먹기 전에,<br />내 기준으로 한 번 더.</h1><p>길고 복잡한 라벨, 이제 사진 한 장으로 똑똑하게 걸러내요.</p></section>
        <section className="scan-card"><div className="scan-card-top"><span><Icon name="camera" size={16} /> 라벨로 확인</span><span>01</span></div><LabelArt /><h2>궁금한 제품이 있나요?</h2><p>원재료 표시를 사진으로 담아주세요.</p><button className="primary" type="button" onClick={() => go('image')}>라벨 확인하기 <Icon name="arrow" size={19} /></button></section>
        <button className="gallery-link" type="button" onClick={() => { go('image'); void pickImage() }}><Icon name="image" size={18} /> 사진첩에서 가져오기 <Icon name="arrow" size={16} /></button>
        <section className="my-criteria"><div className="section-line"><h2><Icon name="sliders" size={20} /> 내 기준</h2><button className="text-button" type="button" disabled={busy || readFailed} onClick={() => go('criteria')}>{selected.length ? '수정' : '설정하기'} <Icon name="arrow" size={15} /></button></div>
          {busy ? <p role="status">내 기준을 불러오고 있어요.</p> : <>
            {review ? <p className="review-prompt">기준 목록이 바뀌었거나 다시 설정이 필요해요. 수정에서 확인해 주세요.</p> : <p>{selected.length ? <>피해요 <b>{avoid}</b> · 알려만줘요 <b>{selected.length - avoid}</b></> : '내가 확인할 원재료를 골라보세요.'}</p>}
            <div className="ingredient-chips">{selected.slice(0, 6).map(c => <button key={c.id} type="button" disabled={readFailed} onClick={() => go('criteria')}><span className={`chip-dot ${effective.get(c.id)}`} /><span>{c.name}</span><small>{strengthLabels[effective.get(c.id)!]}</small></button>)}<button className="chip-add" type="button" disabled={readFailed} onClick={() => go('criteria')} aria-label="기준 추가"><Icon name="plus" size={15} />{selected.length > 6 ? `외 ${selected.length - 6}개` : '기준 추가'}</button></div>
          </>}
        </section><p className="brand-signoff"><Icon name="leaf" size={15} /> 안전한 식탁을 위한 나만의 첫걸음</p>
      </>}
      {page === 'criteria' && (!loaded ? <p className="empty" role="status">기준을 불러오고 있어요.</p> : readFailed ? <p className="empty">기준을 다시 불러온 뒤 설정할 수 있어요.</p> : <CriteriaEditor catalog={catalog} rows={draft} onChange={setDraft} busy={busy} onSave={() => void save()} review={review} onCancel={() => go('home')} />)}
      {page === 'image' && <>
        <section className="intro"><span className="eyebrow">READ THE LABEL</span><h1>이름보다 자세히,<br />원재료를 봐요.</h1><p>제품의 원재료 표시가<br />잘 보이는 사진을 골라주세요.</p></section>
        <div className={`photo-frame ${imageUri ? 'has-photo' : ''}`}>{imageUri ? <img src={imageUri} alt="선택한 원재료 표시" onError={() => { setImageUri(null); setImageMessage('표시할 수 없는 사진이에요. JPG 또는 PNG로 다시 골라주세요.') }} /> : <><LabelArt /><span>원재료명 영역을 담아주세요</span></>}</div>
        <div className="image-actions"><button className="primary" type="button" disabled={imageBusy || extractBusy} onClick={() => void pickImage()}><Icon name="image" size={20} />{imageBusy ? '사진을 불러오는 중…' : imageUri ? '다른 사진 고르기' : '사진 선택하기'}</button><button className="secondary" type="button" disabled={imageBusy || extractBusy} onClick={() => void pickImage(true)}><Icon name="camera" size={20} /> 직접 촬영하기</button>{imageUri && <button className="text-button" type="button" onClick={() => { setImageUri(null); setConsented(false) }}>사진 지우기</button>}</div>
        {imageMessage && <p className="notice" role="status">{imageMessage}</p>}
        {imageUri && <section className="extract-card"><h2>사진에서 원재료 읽기</h2><p>원재료명 부분을 읽기 위해 사진을 분석 서버로 전송해요. 서버는 사진을 저장하지 않고, 읽은 텍스트를 보여준 뒤 직접 수정할 수 있어요.</p><label className="consent"><input type="checkbox" checked={consented} disabled={extractBusy} onChange={event => setConsented(event.target.checked)} /><span>사진 전송과 원재료 텍스트 추출에 동의해요.</span></label><button className="primary" type="button" disabled={!consented || extractBusy} onClick={() => void readPhoto()}>{extractBusy ? '원재료를 읽는 중…' : '원재료 읽기'}</button></section>}
        {analysisMessage && <p className="notice" role="status">{analysisMessage}</p>}
        <div className="photo-note"><strong>사진은 분석 요청에만 사용해요.</strong><p>결과를 신뢰하기 전에 읽은 원재료를 확인하고 필요하면 고쳐 주세요. 사진과 결과는 아직 분석 이력으로 저장하지 않아요.</p></div>
      </>}
      {page === 'review' && <>
        <section className="intro"><span className="eyebrow">CHECK THE TEXT</span><h1>읽은 원재료를<br />한 번 확인해요.</h1><p>사진에서 읽은 내용이에요. 빠졌거나 잘못 읽은 부분은 고친 뒤 비교해 주세요.</p></section>
        <label className="ingredient-editor" htmlFor="ingredient-text"><span>원재료 표시</span><textarea id="ingredient-text" value={ingredientText} maxLength={12000} rows={10} onChange={event => setIngredientText(event.target.value)} placeholder="원재료명을 쉼표로 구분해 입력해 주세요." /></label>
        {analysisMessage && <p className="notice" role="status">{analysisMessage}</p>}
        {selected.length ? <button className="primary" type="button" onClick={compareIngredients}>내 기준과 비교하기 <Icon name="arrow" size={19} /></button> : <section className="empty"><strong>비교할 내 기준이 없어요.</strong><p>기준을 먼저 설정하면 이 원재료와 대조할 수 있어요.</p><button className="secondary" type="button" onClick={() => go('criteria')}>내 기준 설정하기</button></section>}
        <button className="text-button back-step" type="button" onClick={() => go('image')}>사진 다시 고르기</button>
      </>}
      {page === 'result' && analysis && <>
        <section className="intro"><span className="eyebrow">YOUR RESULT</span><h1>내 기준으로<br />표시를 대조했어요.</h1><p>읽은 원재료 {analysis.tokens.length}개와 내가 고른 기준 {selected.length}개를 비교한 결과예요.</p></section>
        <section className="result-summary"><strong>{analysis.findings.filter(finding => effective.get(finding.criterionId) === 'avoid' && finding.state === 'found').length ? '피해요 기준에서 표기를 찾았어요.' : '피해요 기준의 직접 표기는 찾지 못했어요.'}</strong><p>사진에서 읽은 글자와 고친 원재료를 기준으로 한 결과예요.</p></section>
        <div className="result-list">{analysis.findings.map(finding => {
          const criterion = allCriteria(catalog).find(item => item.id === finding.criterionId)
          const state = finding.state === 'found' ? '표기에 발견' : finding.state === 'needs_review' ? '확인 필요' : finding.state === 'unreadable' ? '확인 불가' : '표기에 없음'
          return <article className={`result-row ${finding.state}`} key={finding.criterionId}><div><span className={`result-strength ${effective.get(finding.criterionId)}`}>{strengthLabels[effective.get(finding.criterionId)!]}</span><h2>{criterion?.name ?? finding.criterionId}</h2></div><strong>{state}</strong>{finding.tokens.length > 0 && <p>{finding.tokens.join(' · ')}</p>}{finding.state === 'unreadable' && <p>원재료 구성이 드러나지 않는 묶음 표기가 있어요.</p>}</article>
        })}</div>
        {analysis.opaqueTokens.length > 0 && <p className="notice">묶음 표기: {analysis.opaqueTokens.join(', ')}. 구체적인 원재료가 보이지 않아 선택한 기준별로 확인 불가로 표시될 수 있어요.</p>}
        <div className="result-actions"><button className="primary" type="button" onClick={() => go('review')}>읽은 원재료 고치기</button><button className="secondary" type="button" onClick={() => go('image')}>다른 사진 확인하기</button><button className="text-button" type="button" onClick={() => go('home')}>처음으로</button></div>
        <p className="result-limit">이 결과는 제품의 성분 안전성, 알레르기, 함량 또는 건강 영향을 판단하지 않아요. 표기와 내 기준의 대조 결과예요.</p>
      </>}
    </div>
    <input ref={fileInput} type="file" accept="image/*" hidden onChange={event => { localPhoto(event.target.files?.[0]); event.target.value = '' }} />
    <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={event => { localPhoto(event.target.files?.[0]); event.target.value = '' }} />
  </main>
}

export default App
