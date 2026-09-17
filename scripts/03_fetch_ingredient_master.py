#!/usr/bin/env python3
"""
성분 사전 1단계 — 공공 원재료 마스터 수집

  I2520 식품원재료코드   43,612건 → data/raw/I2520_rawmtrl_code.csv
  I1020 식품원재료 정보  24,875건 → data/raw/I1020_rawmtrl_info.csv

키는 .env.local 의 FOODSAFETY_API_KEY 를 읽는다 (파일에 적지 않는다).
⚠️ 식품안전나라 API는 평일 09~19시에 제한된다(임시 조치). 야간·주말에 실행할 것.

실행: python scripts/03_fetch_ingredient_master.py
"""
import csv, io, json, os, sys, time, urllib.request

RAW = "data/raw"
BASE = "http://openapi.foodsafetykorea.go.kr/api"
CHUNK = 500           # 1회 최대 행수 (서비스별 상한이 다르다. I0950은 500)
SERVICES = [
    ("I2520", "I2520_rawmtrl_code.csv"),    # 식품원재료코드 43,612
    ("I1020", "I1020_rawmtrl_info.csv"),    # 식품원재료 정보 24,875
    ("I0950", "I0950_additive_std.csv"),    # 식품첨가물공전 6,895
]


def load_key():
    for line in io.open(".env.local", encoding="utf-8"):
        if line.startswith("FOODSAFETY_API_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("!! .env.local 에 FOODSAFETY_API_KEY 가 없습니다")


def fetch(key, svc, start, end):
    url = f"{BASE}/{key}/{svc}/json/{start}/{end}"
    with urllib.request.urlopen(url, timeout=60) as r:
        body = json.loads(r.read().decode("utf-8"))
    node = body[svc]
    code = node.get("RESULT", {}).get("CODE", "")
    if code and code != "INFO-000":
        raise RuntimeError(f"{svc} {start}-{end}: {code} {node['RESULT'].get('MSG','')}")
    return node.get("row", []), int(node.get("total_count", 0))


def run(key, svc, out_name):
    rows, total = fetch(key, svc, 1, 1)
    if not rows:
        print(f"  {svc}: 응답 없음"); return
    cols = list(rows[0].keys())
    path = os.path.join(RAW, out_name)
    n = 0
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for start in range(1, total + 1, CHUNK):
            end = min(start + CHUNK - 1, total)
            for attempt in range(3):
                try:
                    batch, _ = fetch(key, svc, start, end)
                    break
                except Exception as e:
                    if attempt == 2:
                        raise
                    print(f"    재시도 {start}-{end}: {e}")
                    time.sleep(3)
            for r in batch:
                w.writerow(r); n += 1
            print(f"\r  {svc}: {n:,}/{total:,}", end="", flush=True)
            time.sleep(0.2)
    print(f"\r  {svc}: {n:,}/{total:,} → {path} ({os.path.getsize(path)/1048576:.1f} MB)")
    return n


if __name__ == "__main__":
    key = load_key()
    os.makedirs(RAW, exist_ok=True)
    print("=== 공공 원재료 마스터 수집 ===")
    for svc, out in SERVICES:
        run(key, svc, out)
    print("완료")
