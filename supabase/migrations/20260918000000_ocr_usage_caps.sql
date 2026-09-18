-- 사진 읽기 사용량과 한도.
-- 무료로 배포하는 서비스라 월 예산이 상한이고, 상한에 닿으면 기능을 닫는다(2026-09-18 결정).
-- 이 표는 서버(Edge Function)만 service_role 로 쓴다. 공개 키로는 읽지도 쓰지도 못한다.

create table if not exists public.ocr_usage_day (
  day date primary key,
  calls bigint not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0
);

create table if not exists public.ocr_usage_device (
  day date not null,
  device_hash text not null,
  calls int not null default 0,
  primary key (day, device_hash)
);

alter table public.ocr_usage_day enable row level security;
alter table public.ocr_usage_device enable row level security;
-- 정책을 두지 않는다 = 공개 키로는 아무 것도 못 한다. service_role 은 RLS 를 지나간다.

-- 한 번의 호출로 "이번 달 예산 안인가 · 이 기기의 오늘 몫이 남았나" 를 보고 자리를 잡아 둔다.
-- 나눠서 확인하면 동시에 들어온 요청이 같은 자리를 두 번 쓴다.
create or replace function public.reserve_ocr_call(
  p_device_hash text,
  p_device_daily_limit int,
  p_monthly_budget_micros bigint,
  p_input_price_micros numeric,   -- 100만 토큰당 마이크로달러
  p_output_price_micros numeric
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spent_micros numeric;
  v_device_calls int;
begin
  select coalesce(sum(input_tokens) * p_input_price_micros / 1000000
                + sum(output_tokens) * p_output_price_micros / 1000000, 0)
    into v_spent_micros
    from ocr_usage_day
   where day >= date_trunc('month', current_date);

  if v_spent_micros >= p_monthly_budget_micros then
    return 'budget';
  end if;

  insert into ocr_usage_device (day, device_hash, calls)
       values (current_date, p_device_hash, 1)
  on conflict (day, device_hash)
    do update set calls = ocr_usage_device.calls + 1
  returning calls into v_device_calls;

  if v_device_calls > p_device_daily_limit then
    return 'device';
  end if;

  insert into ocr_usage_day (day, calls) values (current_date, 1)
  on conflict (day) do update set calls = ocr_usage_day.calls + 1;

  return 'ok';
end;
$$;

-- 실제로 쓴 토큰을 나중에 적는다. 예산은 이 값으로 계산한다.
create or replace function public.record_ocr_tokens(p_input_tokens bigint, p_output_tokens bigint)
returns void
language sql
security definer
set search_path = public
as $$
  insert into ocr_usage_day (day, input_tokens, output_tokens)
       values (current_date, p_input_tokens, p_output_tokens)
  on conflict (day) do update
    set input_tokens = ocr_usage_day.input_tokens + excluded.input_tokens,
        output_tokens = ocr_usage_day.output_tokens + excluded.output_tokens;
$$;

revoke all on function public.reserve_ocr_call(text, int, bigint, numeric, numeric) from public, anon, authenticated;
revoke all on function public.record_ocr_tokens(bigint, bigint) from public, anon, authenticated;
grant execute on function public.reserve_ocr_call(text, int, bigint, numeric, numeric) to service_role;
grant execute on function public.record_ocr_tokens(bigint, bigint) to service_role;
