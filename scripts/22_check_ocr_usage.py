#!/usr/bin/env python3
"""
사진 읽기 사용량과 이번 달 비용 — 월 상한(2만원)에 얼마나 다가갔나

무료로 배포하는 서비스라 월 예산이 상한이다. 상한에 닿으면 Edge Function 이 스스로 막고,
그때는 서비스를 닫고 다시 준비한다(2026-09-18 결정).

  python scripts/22_check_ocr_usage.py

읽기 전용이다. .env.local 의 SUPABASE_URL · SUPABASE_SECRET_KEY 를 쓴다.
"""
import io, json, os, sys, urllib.request
from datetime import date

BUDGET_MICROS = 13_800_000          # 약 2만원 (환율 1,450원)
INPUT_PRICE_MICROS = 250_000        # gemini-3.1-flash-lite, 100만 토큰당 $0.25
OUTPUT_PRICE_MICROS = 1_500_000     # 100만 토큰당 $1.50
KRW = 1450


def env():
    out = {}
    with io.open(".env.local", encoding="utf-8-sig") as f:
        for line in f:
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    return out


def main():
    if (sys.stdout.encoding or "").lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    e = env()
    base, key = e.get("SUPABASE_URL"), e.get("SUPABASE_SECRET_KEY")
    if not base or not key:
        sys.exit("!! .env.local 에 SUPABASE_URL · SUPABASE_SECRET_KEY 가 필요합니다")
    first = date.today().replace(day=1).isoformat()
    req = urllib.request.Request(
        f"{base}/rest/v1/ocr_usage_day?select=*&day=gte.{first}&order=day.desc",
        headers={"apikey": key, "Authorization": f"Bearer {key}"})
    rows = json.loads(urllib.request.urlopen(req, timeout=30).read())

    calls = sum(r["calls"] for r in rows)
    inp = sum(r["input_tokens"] for r in rows)
    out = sum(r["output_tokens"] for r in rows)
    micros = inp * INPUT_PRICE_MICROS / 1e6 + out * OUTPUT_PRICE_MICROS / 1e6
    won = micros / 1e6 * KRW

    print(f"{date.today():%Y-%m} 사용량 — 호출 {calls:,} · 입력 {inp:,} · 출력 {out:,} 토큰")
    print(f"예상 비용 {won:,.0f}원 / 상한 {BUDGET_MICROS/1e6*KRW:,.0f}원 ({micros/BUDGET_MICROS:.1%})")
    # 남은 여유는 실측 기준 한 장(MEDIUM 해상도, 입력 634 · 출력 200 토큰)으로 환산한다.
    per_photo = 634 * INPUT_PRICE_MICROS / 1e6 + 200 * OUTPUT_PRICE_MICROS / 1e6
    print(f"한 장당 {per_photo/1e6*KRW:.2f}원 기준 · 이번 달 {max(BUDGET_MICROS-micros,0)/per_photo:,.0f}장 더 가능")
    print()
    print(f"{'날짜':<12}{'호출':>8}{'입력':>10}{'출력':>9}{'비용(원)':>10}")
    for r in rows:
        day_won = (r["input_tokens"] * INPUT_PRICE_MICROS + r["output_tokens"] * OUTPUT_PRICE_MICROS) / 1e12 * KRW
        print(f"{r['day']:<12}{r['calls']:>8,}{r['input_tokens']:>10,}{r['output_tokens']:>9,}{day_won:>10,.0f}")


if __name__ == "__main__":
    main()
