-- 하루·한 달을 한국 시간으로 센다.
-- current_date 는 서버 시간(UTC)이라 하루 10장이 오전 9시에 다시 채워졌다. 사용자에게 하루는 자정부터다.
create or replace function public.usage_today()
returns date
language sql
stable
set search_path = public
as $$ select (now() at time zone 'Asia/Seoul')::date $$;

create or replace function public.reserve_ocr_call(
  p_device_hash text,
  p_device_daily_limit int,
  p_monthly_budget_micros bigint,
  p_input_price_micros numeric,
  p_output_price_micros numeric
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := usage_today();
  v_spent_micros numeric;
  v_device_calls int;
begin
  select coalesce(sum(input_tokens) * p_input_price_micros / 1000000
                + sum(output_tokens) * p_output_price_micros / 1000000, 0)
    into v_spent_micros
    from ocr_usage_day
   where day >= date_trunc('month', v_today);

  if v_spent_micros >= p_monthly_budget_micros then
    return 'budget';
  end if;

  insert into ocr_usage_device (day, device_hash, calls)
       values (v_today, p_device_hash, 1)
  on conflict (day, device_hash)
    do update set calls = ocr_usage_device.calls + 1
  returning calls into v_device_calls;

  if v_device_calls > p_device_daily_limit then
    return 'device:0';
  end if;

  insert into ocr_usage_day (day, calls) values (v_today, 1)
  on conflict (day) do update set calls = ocr_usage_day.calls + 1;

  return format('ok:%s', greatest(p_device_daily_limit - v_device_calls, 0));
end;
$$;

create or replace function public.record_ocr_tokens(p_input_tokens bigint, p_output_tokens bigint)
returns void
language sql
security definer
set search_path = public
as $$
  insert into ocr_usage_day (day, input_tokens, output_tokens)
       values (usage_today(), p_input_tokens, p_output_tokens)
  on conflict (day) do update
    set input_tokens = ocr_usage_day.input_tokens + excluded.input_tokens,
        output_tokens = ocr_usage_day.output_tokens + excluded.output_tokens;
$$;

revoke all on function public.usage_today() from public, anon, authenticated;
grant execute on function public.usage_today() to service_role;
revoke all on function public.reserve_ocr_call(text, int, bigint, numeric, numeric) from public, anon, authenticated;
revoke all on function public.record_ocr_tokens(bigint, bigint) from public, anon, authenticated;
grant execute on function public.reserve_ocr_call(text, int, bigint, numeric, numeric) to service_role;
grant execute on function public.record_ocr_tokens(bigint, bigint) to service_role;
