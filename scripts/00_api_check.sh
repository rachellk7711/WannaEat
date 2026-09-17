#!/usr/bin/env bash
# WannaEat — 인증키 발급 직후 실행하는 아키텍처 결정 스크립트
#
# 사용법:
#   1) 프로젝트 루트 .env.local 에 FOODSAFETY_API_KEY 가 있어야 한다 (키를 이 파일에 적지 않는다)
#   2) ★ 반드시 낮 시간(09~19시)에 실행한다 ★  ← 이게 핵심 측정이다
#   3) bash scripts/00_api_check.sh
#
# 이 스크립트가 답하는 것:
#   - 정식 키에도 09~19시 제한이 걸리는가  → Plan A vs Plan B 결정
#   - 각 데이터셋의 실제 총 건수           → Supabase 500MB 수용 판단
#   - 원재료명 응답 형태                   → 파서 설계

ENV_FILE="$(dirname "$0")/../.env.local"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
KEY="${FOODSAFETY_API_KEY:-}"

BASE="http://openapi.foodsafetykorea.go.kr/api"
OUT="scripts/_result_$(date +%Y%m%d_%H%M).txt"

echo "실행 시각: $(date '+%Y-%m-%d %H:%M:%S %Z')" | tee "$OUT"
echo "※ 09~19시 사이에 실행했는지 확인하세요 (이 시간대 측정이 핵심)" | tee -a "$OUT"
echo "" | tee -a "$OUT"

if [ -z "$KEY" ]; then
  echo "!! .env.local 에 FOODSAFETY_API_KEY 를 먼저 채워주세요" | tee -a "$OUT"; exit 1
fi

# ── 1. 시간 제한 확인 (가장 중요) ────────────────────────────────
echo "=== [1] 09~19시 서비스 제한 확인 ===" | tee -a "$OUT"
RESP=$(curl -s "$BASE/$KEY/C002/json/1/1")
echo "$RESP" | head -c 800 | tee -a "$OUT"
echo "" | tee -a "$OUT"

if echo "$RESP" | grep -q "ERROR-503"; then
  echo ">>> 판정: 제한 있음 → **Plan B (전량 적재)**" | tee -a "$OUT"
  echo ">>> 낮 시간 실시간 조회 불가. 야간 배치 필요." | tee -a "$OUT"
elif echo "$RESP" | grep -q "INFO-000"; then
  echo ">>> 판정: 제한 없음 → **Plan A (온디맨드 + 캐싱) 가능**" | tee -a "$OUT"
  echo ">>> Supabase 500MB 문제가 사실상 소멸." | tee -a "$OUT"
else
  echo ">>> 판정 불가. 위 응답을 확인하세요." | tee -a "$OUT"
fi
echo "" | tee -a "$OUT"

# ── 2. 데이터셋별 총 건수 ────────────────────────────────────────
echo "=== [2] 총 건수 (Supabase 용량 판단) ===" | tee -a "$OUT"
for SVC in C002 C006 C003 C005 I1250; do
  CNT=$(curl -s "$BASE/$KEY/$SVC/json/1/1" | grep -o '"total_count":"[0-9]*"' | head -1)
  printf "  %-6s %s\n" "$SVC" "$CNT" | tee -a "$OUT"
  sleep 1
done
echo "" | tee -a "$OUT"

# ── 3. 원재료명 응답 형태 (파서 설계용) ──────────────────────────
echo "=== [3] 원재료명 실제 형태 — 파서 설계 근거 ===" | tee -a "$OUT"
echo "-- C002 무작위 3건 --" | tee -a "$OUT"
curl -s "$BASE/$KEY/C002/json/1/3" | tee -a "$OUT"
echo "" | tee -a "$OUT"
echo "-- 저탄고지 키워드 검색 (무설탕) --" | tee -a "$OUT"
curl -s "$BASE/$KEY/C002/json/1/3/PRDLST_NM=무설탕" | tee -a "$OUT"
echo "" | tee -a "$OUT"
echo "-- C006 축산물 3건 (치즈·버터·소시지 커버 확인) --" | tee -a "$OUT"
curl -s "$BASE/$KEY/C006/json/1/3" | tee -a "$OUT"
echo "" | tee -a "$OUT"
echo "-- C006 치즈 검색 --" | tee -a "$OUT"
curl -s "$BASE/$KEY/C006/json/1/3/PRDLST_NM=치즈" | tee -a "$OUT"
echo "" | tee -a "$OUT"

echo "-- ★ C003 건기식 — 함량(%) 표기가 실제로 있는지 확인 --" | tee -a "$OUT"
curl -s "$BASE/$KEY/C003/json/1/3" | tee -a "$OUT"
echo "" | tee -a "$OUT"
echo "-- C003 MCT 검색 (저탄고지 핵심 품목) --" | tee -a "$OUT"
curl -s "$BASE/$KEY/C003/json/1/3/PRDLST_NM=MCT" | tee -a "$OUT"
echo "" | tee -a "$OUT"

echo "-- C005 바코드연계 3건 (OCR 우회 경로 커버리지) --" | tee -a "$OUT"
curl -s "$BASE/$KEY/C005/json/1/3" | tee -a "$OUT"
echo "" | tee -a "$OUT"

# ── 4. 확인 체크리스트 ──────────────────────────────────────────
cat <<'EOF' | tee -a "$OUT"

=== [4] 응답을 보고 직접 확인할 것 ===
[ ] 원재료명 구분자가 "," 인가 ", "(쉼표+공백) 인가
[ ] 괄호 안에 쉼표가 있는 사례가 보이는가  (단순 split 금지 근거)
[ ] RAWMTRL_ORDNO 가 실제로 뒤섞여 있는가  (버리기로 한 판단 재확인)
[ ] 원재료가 "기타가공품" 처럼 유형명만 있는 사례 비율
[ ] PRDLST_DCNM(품목유형) 값의 종류  (부분 적재 필터 설계용)
[ ] ★ C003 원재료명에 "함량 00%" 표기가 실제로 있는가
      → 있으면 C003 데이터 품질이 C002보다 우수하다는 뜻
[ ] C006 치즈 검색에서 실제 제품이 나오는가  (축산물 커버리지)
[ ] C005 바코드 데이터가 최근 제품을 포함하는가
      → 2018년 이후 갱신 중단 보고가 있으므로 실측 필요

=== 다음 단계 ===
- 제한 없음 → Plan A. 계획서 §아키텍처 설계 원칙 참조
- 제한 있음 → Plan B. 파일 일괄 다운로드 가능 여부가 관건 (Codex 과제 5)
EOF

echo ""
echo "결과 저장: $OUT"
