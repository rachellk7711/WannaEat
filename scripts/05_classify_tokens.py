#!/usr/bin/env python3
"""
성분 사전 3단계 — 미매칭 토큰 LLM 일괄 분류

입력  data/prepared/ingredient_tokens.csv   (status=unmatched 만)
출력  data/prepared/ingredient_classified.csv

묻는 것: "이 토큰이 무엇이고 어느 범주인가" — 분류만.
묻지 않는 것: 저탄고지 판정. 그건 사람이 한다 (계획서 §설계 원칙 1).

특징
  - 이어서 실행 가능 (이미 분류된 토큰은 건너뜀)
  - 503(과부하) 재시도, 배치 실패 시 건너뛰고 계속
  - 한글은 Python에서 UTF-8로 직접 전송 (셸 인코딩 문제 회피)

실행: python scripts/05_classify_tokens.py [최대토큰수]
"""
import csv, io, json, os, sys, time, urllib.request, urllib.error

PREP = "data/prepared"
SRC = os.path.join(PREP, "ingredient_tokens.csv")
OUT = os.path.join(PREP, "ingredient_classified.csv")
# ── 무료 티어 전략 ────────────────────────────────────────
# 병목은 토큰이 아니라 '하루 요청 수(RPD)'다.
#   Gemini 3.6 Flash : RPM 5 · TPM 250K · RPD 20
#   TPM 여유가 크므로 배치를 키워 호출 수를 줄인다.
# 그리고 모델마다 RPD 버킷이 따로다 → 한 모델이 막히면 다음 모델로 넘어간다.
MODELS = ["gemini-3.6-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite-preview"]
BATCH = 400        # 400개 × 3모델 × 20회 = 하루 최대 24,000종
PAUSE = 13         # RPM 5 → 분당 4~5회로 억제


def url_for(model):
    return f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

PROMPT = """다음은 한국 가공식품 포장의 원재료명 표기 목록이다. 각 항목을 분류하라.

category (하나만):
  원물        - 가공하지 않은 농·축·수산물 (예: 쌀, 돼지고기, 표고버섯)
  가공품      - 원물을 가공한 것 (예: 간장, 전분, 정제유)
  첨가물      - 식품첨가물 (예: 구연산, 향료 성분, 유화제)
  복합원재료  - 하위 원료가 드러나지 않는 묶음 표기 (예: 복합조미식품, 혼합제제, 소스)
  불명        - 오타·깨진 문자·판단 불가

group (하나만): 당류 | 전분 | 감미료 | 유지 | 향료 | 조미 | 기타
  저탄고지 판정에서 중요한 축만 구분한다. 해당 없으면 기타.

std_name: 더 일반적인 표준 표기가 있으면 적고, 없으면 토큰을 그대로.

입력 토큰:
"""

SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "token": {"type": "STRING"},
            "category": {"type": "STRING"},
            "group": {"type": "STRING"},
            "std_name": {"type": "STRING"},
        },
        "required": ["token", "category", "group", "std_name"],
    },
}


def load_key():
    for line in io.open(".env.local", encoding="utf-8"):
        if line.startswith("GEMINI_API_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("!! .env.local 에 GEMINI_API_KEY 가 없습니다")


def call(key, tokens, model):
    payload = {
        "contents": [{"parts": [{"text": PROMPT + "\n".join(tokens)}]}],
        "generationConfig": {
            "maxOutputTokens": 60000,   # 배치 400개면 출력이 1.5만 토큰을 넘는다
            "responseMimeType": "application/json",
            "responseSchema": SCHEMA,
            "temperature": 0,
        },
    }
    req = urllib.request.Request(
        url_for(model),
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8", "x-goog-api-key": key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        body = json.loads(r.read().decode("utf-8"))
    cand = body.get("candidates", [])
    if not cand:
        raise RuntimeError(f"응답 없음: {str(body)[:200]}")
    text = cand[0]["content"]["parts"][0]["text"]
    usage = body.get("usageMetadata", {})
    return json.loads(text), usage.get("totalTokenCount", 0)


def main():
    key = load_key()
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None

    todo = []
    with io.open(SRC, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            if row["status"] == "unmatched":
                todo.append((row["token"], int(row["occurrences"])))

    # 실패·미응답 행은 '완료'로 치지 않는다 — 재실행 때 다시 시도해야 한다
    done = set()
    if os.path.exists(OUT):
        with io.open(OUT, encoding="utf-8", newline="") as f:
            done = {r["token"] for r in csv.DictReader(f)
                    if r["category"] not in ("실패", "미응답", "")}
    todo = [t for t in todo if t[0] not in done]
    if limit:
        todo = todo[:limit]
    print(f"분류 대상 {len(todo):,}종 (완료 {len(done):,}종)")
    if not todo:
        return

    new = not os.path.exists(OUT)
    f = io.open(OUT, "a", encoding="utf-8", newline="")
    w = csv.writer(f)
    if new:
        w.writerow(["token", "occurrences", "category", "group", "std_name"])

    occ = dict(todo)
    total_tok = ok = fail = 0
    mi = 0                       # 현재 사용 중인 모델 (한도에 걸리면 다음으로)
    for i in range(0, len(todo), BATCH):
        chunk = [t for t, _ in todo[i:i + BATCH]]
        if mi >= len(MODELS):
            print("\n!! 모든 모델의 하루 한도 소진 — 내일 이어서 실행하세요")
            break
        overloaded = 0
        for attempt in range(4):
            # 503(과부하)이 두 번 이어지면 이 배치만 다음 모델로 보내 본다.
            # 하루 한도(429)와 달리 모델을 영구히 바꾸지는 않는다.
            model = MODELS[min(mi + (1 if overloaded >= 2 else 0), len(MODELS) - 1)]
            try:
                items, used = call(key, chunk, model)
                total_tok += used
                got = {d.get("token"): d for d in items if isinstance(d, dict)}
                for t in chunk:
                    d = got.get(t)
                    if d:
                        w.writerow([t, occ.get(t, 0), d.get("category", ""),
                                    d.get("group", ""), d.get("std_name", "")])
                        ok += 1
                    else:
                        w.writerow([t, occ.get(t, 0), "미응답", "", ""]); fail += 1
                f.flush()
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    # 응답 전체를 읽는다. 한도 종류(quotaId …PerDay…)는 앞 300자 뒤에 나온다.
                    # 앞부분만 보던 탓에 하루 한도를 분당 한도로 오인해 찬 모델만 계속 두드렸다.
                    body = e.read().decode()
                    if "credits are depleted" in body:
                        print("\n!! 크레딧 소진 — 중단합니다"); f.close(); return
                    if "PerDay" in body or "per day" in body.lower():
                        mi += 1                     # 하루 한도 → 다음 모델로
                        print(f"\n  {MODELS[mi-1]} 하루 한도 소진 → "
                              f"{MODELS[mi] if mi < len(MODELS) else '없음'}")
                        break
                    wait = 30 * (attempt + 1)       # 분당 한도: 잠깐 쉰다
                elif e.code == 503:
                    overloaded += 1
                    wait = 45 * (attempt + 1)       # 서버 과부하: 짧게 재시도하면 또 걸린다
                else:
                    wait = 5 * (attempt + 1)
                print(f"\n  HTTP {e.code} — {wait}초 후 재시도 ({i}~{i+len(chunk)})")
                time.sleep(wait)
                if attempt == 3:
                    for t in chunk:
                        w.writerow([t, occ.get(t, 0), "실패", "", ""]); fail += 1
                    f.flush()
            except Exception as e:
                print(f"\n  오류: {str(e)[:120]}")
                time.sleep(3)
                if attempt == 3:
                    for t in chunk:
                        w.writerow([t, occ.get(t, 0), "실패", "", ""]); fail += 1
                    f.flush()
        print(f"\r  {min(i+BATCH, len(todo)):,}/{len(todo):,}  성공 {ok:,} 실패 {fail:,} "
              f"토큰 {total_tok:,}", end="", flush=True)
        time.sleep(PAUSE)
    f.close()
    print(f"\n완료 → {OUT}")


if __name__ == "__main__":
    main()
