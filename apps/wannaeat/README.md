# 알고먹을래? (WannaEat) 앱인토스 WebView

이 폴더는 앱인토스용 React·TypeScript WebView 미니앱이다. 상위 폴더의 데이터 구축 코드와 문서를 공유한다.

## 실행

```bash
npm install
npm run dev
npm run lint
npm test
npm run build
```

`npm run build`는 웹 정적 파일과 `wannaeat.ait`를 만든다. `.ait`는 생성물이며 저장소에 넣지 않는다. 로컬 브라우저의 AIT Devtools는 UI 개발용이다. 토스 앱의 권한·내비게이션·네트워크 동작은 콘솔 QR 테스트로 확인해야 한다.

## 현재 구현

- 녹색 A안을 실제 첫 화면·기준 설정·사진 화면에 적용
- 카탈로그의 분류 → 소분류 → 기준 구조, 표기 예시·제외 예시·설명·검색어 연결
- 피해요(`avoid`) / 알려만줘요(`inform`) 두 단계. 사전 선택·식단 프리셋 없음
- `selectAll: true`인 소분류만 전체 선택. 개별 변경·해제와 전체 선택의 충돌 처리
- 실제 Supabase Storage에서 공개 카탈로그와 판정 규칙을 읽고 SHA-256 검증. 연결 실패 시 최근 검증본, 없으면 번들 사용
- 토스에서는 `Storage` SDK, 일반 브라우저에서는 `localStorage`를 이용한 기기 내 기준 저장
- 사진첩 선택·카메라 촬영, **보낼 영역 자르기·전송 전 확인**, Edge Function의 원재료 텍스트 추출, 사용자 수정, 고정 규칙 대조와 결과 표시
- 사진은 브라우저에서 자른 뒤 긴 변 1600px·JPEG 로 다시 그려 보낸다. 원본과 잘라낸 바깥 영역은 서버로 가지 않는다
- 사진·읽은 텍스트·결과는 분석 이력으로 저장하지 않음. OCR은 인쇄된 원재료를 읽기만 하며 성분의 포함 여부를 추정하지 않음
- **분석 이력**: 기기 안에만 최근 30건 저장(`wannaeat.history.v1`). 사진은 저장하지 않고 읽은 원재료·그때의 기준·결과만 남긴다. 한 건씩 또는 전체 삭제 가능
- 토스 사용자 인증·이력의 서버 동기화·결제는 아직 연결하지 않음

## 사용자 기준 저장 계약

저장 키는 `wannaeat.criteria.v2`다. 한 목록에 버전을 붙인다.

```json
{
  "rulesetVersion": "2026-09-18-ad6ed2a5eab4",
  "selections": [
    { "kind": "subgroup", "id": "grains", "strength": "avoid" },
    { "kind": "criterion", "id": "wheat", "strength": "inform" }
  ]
}
```

- 소분류 전체 선택보다 개별 기준 설정을 우선한다. 위 예시는 곡물 전체를 피하되 밀은 알려만준다.
- 전체 선택에 포함된 항목 하나를 해제하면, 나머지 항목을 개별 선택으로 풀어 저장한다. 세 번째 강도를 만들지 않는다.
- 소분류 전체 강도를 다시 지정하면 그 소분류의 개별 변경도 함께 새 강도로 바뀐다.
- `includedIn`은 원본 생성기에서 표기의 동시 출현으로 계산한 참고 관계다. 논리적인 완전 포함으로 해석하거나 자동 선택에 사용하지 않는다.
- `aliases`는 선택 화면 검색에만 사용한다. 실제 판정은 별도의 검증된 규칙·제외 조건·확신도를 연결해야 한다.
- 목록의 버전은 원본 `version` + 파일 SHA-256 앞 12자리다. 같은 날짜의 수정도 구분한다. 실제 판정 규칙을 추가할 때는 그 규칙까지 포함한 버전으로 확장해야 한다.
- 버전 변경·삭제된 ID·손상된 저장 자료는 사용자 확인 후 다시 저장한다. 이전 v2 원문은 `.previous` 키에 백업한다.
- 이름만 저장한 v1은 두 단계로 임의 변환하지 않는다. 사용자에게 다시 선택하도록 안내하고 원문을 유지한다.
- 토스 로그인 연결 전에는 사용자 기준을 Supabase로 전송하지 않는다.

## Supabase 연결과 카탈로그 배포

현재 프로젝트: `rnfhcwoqcrdoevabtjku`.

현재는 **관계형 테이블을 만들지 않고** 공통 참조 자료를 Supabase Storage의 `wannaeat-reference` 공개 버킷으로 배포한다. 사진·사용자 기준은 이 버킷에 올리지 않는다. 모든 사용자가 동일한 카탈로그와 판정 규칙을 읽는 구조에 맞춘 선택이다. 데이터 수집·정리 원본은 로컬에 유지한다.

1. `.env.example`을 이 앱 폴더의 `.env.local`로 복사하고 공개 키를 설정한다.
2. 프로젝트 루트 `.env.local`에는 배포 스크립트용 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`를 둔다. 시크릿 키에 `VITE_` 접두사를 붙이지 않는다.
3. Claude의 데이터 정리가 끝난 시점에 `npm run catalog:sync`로 `data/prepared/criteria_catalog.json`, `criteria_rules.csv`, `opaque_terms.csv`를 함께 검증·복사한다. 개발/빌드 중에는 원본을 자동으로 덮어쓰거나 다시 읽지 않는다.
4. `npm test`로 선택 계약을 확인한 뒤 `npm run catalog:publish`를 실행한다.

배포 스크립트는 버전별 카탈로그와 판정 규칙 파일을 신규 업로드하고 공개 읽기 체크섬을 확인한 뒤 `catalogs/latest.json`의 버전 포인터를 바꾼다. 같은 버전에 다른 내용을 덮어쓰지 않는다. 원본 데이터를 가진 환경에서만 `catalog:sync`를 실행할 수 있다. Git clone만 한 환경은 포함된 스냅샷으로 실행·테스트·빌드할 수 있다.

Storage 공개 버킷은 읽기를 허용하지만, 쓰기·삭제에는 별도 권한이 적용된다. 쓰기용 공개 정책을 추가하지 않는다. [공식 접근 제어 문서](https://supabase.com/docs/guides/storage/security/access-control)

### 원재료 추출 함수 배포

함수 코드는 `supabase/functions/extract-ingredients/`에 있다. `supabase/config.toml`에서 JWT 검증을 끄는 대신 허용 출처·4MB 형식 제한·동일 실행 인스턴스 내 요청 제한을 적용한다. 토스 익명키 검증과 서버 단위 요청 제한을 붙이기 전의 초기 배포용 보호 장치다. 앱인토스 인증 연동 후에는 이 함수를 토스에서 검증한 세션으로 제한해야 한다.

1. Supabase Dashboard의 Edge Functions Secrets에서 `GEMINI_API_KEY`를 설정하거나, `supabase/.env.example`을 `supabase/.env`로 복사해 값을 넣는다.
2. `npx supabase login`으로 프로젝트 소유 계정에 로그인한다.
3. 비밀 파일을 쓸 경우 `npx supabase secrets set --env-file supabase/.env --project-ref rnfhcwoqcrdoevabtjku`를 실행한다.
4. 앱 폴더에서 `npm run functions:deploy`를 실행한다.

`GEMINI_API_KEY`, Supabase secret key, 개인 토큰은 `VITE_` 접두사로 만들거나 커밋하지 않는다. 함수가 사진을 Storage나 Postgres에 저장하지 않으며, Gemini에는 요청 처리에 필요한 사진만 전달한다. 공급자 측 데이터 취급은 출시 전 사용하는 Gemini API 요금제의 약관으로 별도 검토한다.

사용자 기준의 서버 저장은 검증된 토스 사용자 인증과 사용자별 RLS/서버 API를 설계한 뒤 구현한다. 공개 키나 클라이언트가 보낸 임의 사용자 ID만으로 개인 설정을 공유하지 않는다.

## 검증

- `npm test`: 소분류 예외, 개별 해제, 포함 관계, 저장 계약, 잘못된 카탈로그와 검색 회귀 검증
- `npm run lint`, `npm run build`: 정적 검사와 실제 `.ait` 생성
- `tests/browser-check.html`: 실제 Supabase 읽기, 오프라인 대체, 선택·저장·새로고침·취소·버전 변경·손상 데이터·320/360/390px 가로 넘침 검증. **테스트용 새 브라우저 프로필에서만 실행**한다. 시작 시 해당 origin의 localStorage를 비운다.
- Windows에서 별도 프로필로 DOM 검증하려면 다음 명령을 사용한다. 화면 캡처는 생성하지 않는다.

```powershell
$testProfile = Join-Path $env:TEMP 'wannaeat-catalog-check'
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' --headless=new --disable-gpu --user-data-dir=$testProfile --virtual-time-budget=40000 --dump-dom 'http://127.0.0.1:5173/tests/browser-check.html?run=isolated'
```

브라우저 검증은 네이티브 토스 검증을 대신하지 않는다. 실기기에서 Storage, 카메라/사진 권한, 뒤로가기, 공개 Storage 도메인 접근을 별도로 확인해야 한다.

## 디자인 시안 비교

개발 서버를 실행한 뒤 `/design.html`을 열면 두 시안을 비교할 수 있다.

- A안: `/design.html?concept=a` — 딥그린·세이지, 확인 기능 중심의 카드 구성
- B안: `/design.html?concept=b` — 코랄·크림, 취향과 선택을 강조하는 구성
- 두 시안 모두 홈·내 기준·사진 선택 화면을 이동할 수 있다. 원재료는 예시 데이터이며 실제 분석이나 DB 저장을 수행하지 않는다.
- 이 페이지는 디자인 검토용 별도 진입점이다. 현재 기본 출시 빌드의 진입점은 `index.html`이다. 상단 내비게이션은 시안용 모형이며 실제 SDK UI는 실기기에서 별도로 적용·확인한다.

## 콘솔 등록 전에 확인

`apps-in-toss.config.ts`의 `appName`은 임시값 `wannaeat`이다. 콘솔에서 사용할 수 있는 이름을 확정하고 같은 값으로 맞춰야 한다. 프로젝트 폴더 이름에 `toss`를 쓰면 공식 생성기의 `appName` 검사에 걸려 `apps/wannaeat`으로 만들었다.

출시 설계와 남은 작업은 상위 [계획서(토스).md](../../계획서(토스).md)를 본다.
