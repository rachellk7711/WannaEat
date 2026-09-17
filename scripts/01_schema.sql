-- WannaEat 스키마 v2  (2026-09-14)
-- 근거: data/raw/*.csv 실측 + 사용자 검토 결정 10항목
--
-- 설계 원칙 (계획서 §아키텍처 설계 원칙):
--   - 원재료명은 문자열 그대로 보관, 파싱은 애플리케이션에서
--   - RAWMTRL_ORDNO 는 순서 복원 키 → 반드시 유지 (3개 이상 행의 약 60%가 정렬 필요)
--   - 원재료명에 GIN trigram 인덱스 안 검 (성분→제품 역방향 검색은 MVP 밖)
--   - 정규화 제품명은 컬럼이 아니라 IMMUTABLE 함수 표현식 인덱스로
--
-- v2 변경 (사용자 결정 2026-09-14):
--   1. 바코드(C005) 테이블 삭제 — MVP에 바코드 입력 없음, 2018년 갱신 중단
--   2. 같은 품목번호인데 내용이 다른 행은 전부 폐기 (부정확한 정보보다 "정보 없음"이 낫다)
--   3. RLS 1차 구현에 포함
--   4. 기준 설정 상태 추가 (미설정 / 모드 기본값 / 직접 선택)
--   6. 분석 이력 필수 필드 명시
--   8. 증분 갱신 폐기 → 월 1회 CSV 전체 재적재

-- ─────────────────────────────────────────────
-- 0. 확장
-- ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ★ 스파이크: 이 결과가 매칭 아키텍처를 결정한다
--   SELECT show_trgm('초코파이');   -- 빈 배열이면 한글 미지원 → 재설계
--   SELECT similarity('초코파이','오리온 초코파이 정');

-- ─────────────────────────────────────────────
-- 1. 제품 마스터 (C002 + C006 + C003 통합)
-- ─────────────────────────────────────────────
CREATE TABLE products (
    prdlst_report_no  text PRIMARY KEY,       -- 품목보고번호. 조인키
    source            char(1) NOT NULL,       -- 'F'=C002 식품, 'L'=C006 축산물, 'H'=C003 건기식
    prdlst_nm         text NOT NULL,          -- 제품명. 매칭 대상
    bssh_nm           text,                   -- 업소명. 리랭킹 가산점용 (필터 금지 - PB/OEM)
    prdlst_dcnm       text,                   -- 품목유형. 하드 게이트용
    rawmtrl_nm        text NOT NULL,          -- 원재료명 원문 (", " 구분, 괄호 중첩 있음)
    rawmtrl_ordno     text,                   -- 표시순서 복원 키. "7,6,5,4,3,2,1" 형태
    xport_yn          char(1),                -- N=내수 / O=겸용 / null. C006엔 없음
    prms_dt           date,                   -- 최초 보고일 (참고용)
    chng_dt           date,                   -- 변경일. 증분 갱신 기준
    raw_loaded_at     timestamptz DEFAULT now()  -- 우리가 적재한 시점
);

-- C003 전용 부가 정보 (건기식은 함량% 있고 기능성 정보 있음 - 별도 테이블로 products 가볍게 유지)
CREATE TABLE product_health_ext (
    prdlst_report_no  text PRIMARY KEY REFERENCES products(prdlst_report_no),
    primary_fnclty    text,   -- 주된 기능성
    ntk_mthd          text,   -- 섭취방법
    prdt_shap         text    -- 제형 (캡슐/정제/분말)
);

-- ─────────────────────────────────────────────
-- 2. (삭제됨) 바코드 → 품목보고번호
--    C005는 적재하지 않는다. 근거:
--      - MVP 입력 경로에 바코드 스캔이 없다
--      - 제공기관이 2018년 이후 갱신 중단을 명시했다
--      - 바코드 13,740개가 서로 다른 품목번호에 연결돼 있어 정답을 고를 수 없다
-- ─────────────────────────────────────────────
-- 3. 성분 사전 (룰셋 - 앱 시작 시 전량 메모리 로드)
-- ─────────────────────────────────────────────
CREATE TABLE ingredient_master (
    id            bigserial PRIMARY KEY,
    std_name      text UNIQUE NOT NULL,     -- 표준명
    category      text,                     -- 당류 / 감미료 / 유지 / 증점제 ...
    axis          text[],                   -- {a} 탄수은닉 / {b} 초가공지표 / {a,b}
    purpose       text                      -- 용도 (향미증진제 등) - 식약처 첨가물 API
);

CREATE TABLE ingredient_alias (
    alias         text PRIMARY KEY,         -- 구연산
    std_id        bigint NOT NULL REFERENCES ingredient_master(id)  -- → 시트르산
);

-- ─────────────────────────────────────────────
-- 4. 모드 & 사용자 기준
-- ─────────────────────────────────────────────
CREATE TABLE diet_modes (
    id      text PRIMARY KEY,               -- 'lchf'
    name    text NOT NULL                   -- '저탄고지·카니보어'
);

CREATE TABLE mode_default_rules (
    mode_id       text REFERENCES diet_modes(id),
    ingredient_id bigint REFERENCES ingredient_master(id),
    strength      smallint NOT NULL,        -- 0=무관 1=소량허용 2=완전제한
    PRIMARY KEY (mode_id, ingredient_id)
);

-- 사용자별 성분 강도. 행이 있다 = 사용자가 직접 정한 값
CREATE TABLE user_criteria (
    user_id       uuid NOT NULL,            -- auth.users
    ingredient_id bigint NOT NULL REFERENCES ingredient_master(id),
    strength      smallint NOT NULL CHECK (strength IN (0,1,2)),  -- 0=무관 1=소량허용 2=완전제한
    PRIMARY KEY (user_id, ingredient_id)
);

-- 기준 설정 상태 — "행이 없다"의 뜻을 명확히 하기 위한 테이블
--   status='unset'     아직 설정 안 함        → 분석 API가 거부하고 설정 화면으로 보낸다
--   status='mode'      모드 기본값을 그대로 씀 → user_criteria 에 없는 성분은 mode_default_rules 적용
--   status='custom'    직접 조정함            → user_criteria 가 우선, 없는 성분은 모드 기본값
-- criteria_version: 확정 시점의 버전. 운영자가 모드 기본값을 바꿔도
--                   기존 사용자의 판정이 조용히 달라지지 않게 한다
CREATE TABLE user_criteria_state (
    user_id           uuid PRIMARY KEY,     -- auth.users
    status            text NOT NULL DEFAULT 'unset'
                      CHECK (status IN ('unset','mode','custom')),
    mode_id           text REFERENCES diet_modes(id),
    criteria_version  integer NOT NULL DEFAULT 1,
    confirmed_at      timestamptz,          -- 사용자가 '확정'을 누른 시점
    updated_at        timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 5. 성장 루프 (사용자가 쓸수록 정확해지는 자산)
-- ─────────────────────────────────────────────
-- 쇼핑몰 상품명 → 품목번호 매핑.
-- MVP는 "개인 캐시"로만 쓴다 — 저장한 본인에게만 적용된다.
-- 한 사람의 잘못된 선택이 전체 사용자에게 퍼지지 않게 하기 위함.
-- 공용 승격(scope='global')은 같은 선택이 여러 번 쌓이거나 사람이 검토한 뒤에만.
CREATE TABLE product_alias (
    user_id           uuid NOT NULL,        -- 확인한 사람
    shop_title_norm   text NOT NULL,        -- 정규화된 쇼핑몰 상품명
    prdlst_report_no  text REFERENCES products(prdlst_report_no),
    scope             text NOT NULL DEFAULT 'user' CHECK (scope IN ('user','global')),
    confirmed_at      timestamptz DEFAULT now(),
    confidence        real,
    PRIMARY KEY (user_id, shop_title_norm)
);

CREATE TABLE ingredient_feedback (
    id            bigserial PRIMARY KEY,
    raw_token     text NOT NULL,            -- 사전에 없던 성분명
    suggested_std text,                     -- LLM 제안
    status        text DEFAULT 'pending',   -- pending / approved / rejected
    created_at    timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 6. 분석 이력 (리텐션 + 가정 검증 데이터)
-- ─────────────────────────────────────────────
-- 분석 이력. 사용자가 나중에 다시 볼 수 있어야 하고,
-- "그때 어떤 기준으로 판정했는지"가 함께 남아야 한다.
CREATE TABLE analysis_history (
    id                bigserial PRIMARY KEY,
    user_id           uuid NOT NULL,
    judged_at         timestamptz NOT NULL DEFAULT now(),  -- 판정일
    prdlst_nm         text NOT NULL,        -- 제품명 (DB 매칭 실패해도 남긴다)
    prdlst_report_no  text,                 -- 매칭 성공 시에만
    source_type       text NOT NULL CHECK (source_type IN ('capture','camera','product_name','text')),
    verdict           text NOT NULL,        -- 판정 결과: 'front'/'middle'/'back'/'not_found'/'hold'
    unknown_count     smallint NOT NULL DEFAULT 0,         -- 확인 불가 성분 수
    criteria_version  integer NOT NULL,     -- 당시 사용자 기준 버전 → 하이퍼링크로 연결
    ruleset_version   integer NOT NULL,     -- 당시 성분 사전·룰셋 버전
    result_json       jsonb,                -- 상세 스냅샷 (원재료 전사·매칭된 성분·확인 불가 항목·출처)
    created_at        timestamptz DEFAULT now()
);

-- 당시 기준 스냅샷 — 이력에서 "그때 내 기준 보기" 링크가 가리키는 대상
CREATE TABLE criteria_snapshot (
    user_id           uuid NOT NULL,
    criteria_version  integer NOT NULL,
    mode_id           text,
    rules_json        jsonb NOT NULL,       -- 확정 시점의 성분별 강도 전체
    created_at        timestamptz DEFAULT now(),
    PRIMARY KEY (user_id, criteria_version)
);

-- ─────────────────────────────────────────────
-- 7. 인덱스 — 스파이크에서 3단계로 나눠 측정한다
-- ─────────────────────────────────────────────

-- [필수] 제품명 매칭. 정규화는 함수 표현식으로 (컬럼 저장 안 함)
CREATE OR REPLACE FUNCTION norm_pname(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT lower(regexp_replace(t, '\s+', '', 'g'))
  $$;

-- 측정 A: 인덱스 없이 적재만
-- 측정 B: 아래 3개만
CREATE INDEX idx_products_pname_trgm ON products USING gin (norm_pname(prdlst_nm) gin_trgm_ops);
CREATE INDEX idx_products_dcnm       ON products (prdlst_dcnm);
CREATE INDEX idx_products_chng       ON products (chng_dt);

-- 측정 C: 원재료명 GIN 추가 (역방향 검색용 - MVP엔 불필요, 용량 확인용)
-- CREATE INDEX idx_products_raw_trgm ON products USING gin (rawmtrl_nm gin_trgm_ops);

CREATE INDEX idx_alias_report   ON product_alias (prdlst_report_no);
CREATE INDEX idx_history_user   ON analysis_history (user_id, judged_at DESC);

-- ─────────────────────────────────────────────
-- 8. RLS — 사용자 데이터를 넣기 전에 반드시 적용 (1차 구현 포함)
-- ─────────────────────────────────────────────

-- 개인 데이터: 본인 행만 읽고 쓴다
ALTER TABLE user_criteria       ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_criteria_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE criteria_snapshot   ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_alias       ENABLE ROW LEVEL SECURITY;

CREATE POLICY own_criteria       ON user_criteria
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY own_criteria_state ON user_criteria_state
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY own_history        ON analysis_history
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY own_snapshot       ON criteria_snapshot
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- 별칭: 내 것 + 공용 승격된 것을 읽고, 쓰기는 내 것만
CREATE POLICY read_alias  ON product_alias
    FOR SELECT USING (auth.uid() = user_id OR scope = 'global');
CREATE POLICY write_alias ON product_alias
    FOR INSERT WITH CHECK (auth.uid() = user_id AND scope = 'user');

-- 공용 마스터: 로그인 사용자는 읽기만. 쓰기는 서버(service_role)만
ALTER TABLE products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_health_ext ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_master  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_alias   ENABLE ROW LEVEL SECURITY;
ALTER TABLE diet_modes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE mode_default_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY read_products   ON products           FOR SELECT TO authenticated USING (true);
CREATE POLICY read_health_ext ON product_health_ext FOR SELECT TO authenticated USING (true);
CREATE POLICY read_ing_master ON ingredient_master  FOR SELECT TO authenticated USING (true);
CREATE POLICY read_ing_alias  ON ingredient_alias   FOR SELECT TO authenticated USING (true);
CREATE POLICY read_modes      ON diet_modes         FOR SELECT TO authenticated USING (true);
CREATE POLICY read_mode_rules ON mode_default_rules FOR SELECT TO authenticated USING (true);

-- 미등록 성분 제보: 로그인 사용자는 넣기만 하고, 조회·승인은 서버에서
ALTER TABLE ingredient_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_feedback ON ingredient_feedback FOR INSERT TO authenticated WITH CHECK (true);

-- ⚠️ 정책을 건 것으로 끝내지 않는다.
--    익명 · 계정 A · 계정 B 로 서로의 행에 접근을 시도해 실제로 막히는지 확인한다.

-- ─────────────────────────────────────────────
-- 8. 용량 측정 쿼리 (각 측정 단계마다 실행)
-- ─────────────────────────────────────────────
-- SELECT
--   relname,
--   pg_size_pretty(pg_total_relation_size(relid)) AS total,
--   pg_size_pretty(pg_relation_size(relid))       AS table_only,
--   pg_size_pretty(pg_indexes_size(relid))        AS indexes
-- FROM pg_catalog.pg_statio_user_tables
-- ORDER BY pg_total_relation_size(relid) DESC;
--
-- SELECT pg_size_pretty(pg_database_size(current_database())) AS db_total;
