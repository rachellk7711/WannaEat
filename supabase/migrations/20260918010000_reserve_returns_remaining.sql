-- 남은 횟수를 화면에 보여주려면 자리를 잡아 줄 때 함께 알려줘야 한다.
-- 'ok:7' · 'device:0' · 'budget' 형태로 돌려준다.
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
    return 'device:0';
  end if;

  insert into ocr_usage_day (day, calls) values (current_date, 1)
  on conflict (day) do update set calls = ocr_usage_day.calls + 1;

  return format('ok:%s', greatest(p_device_daily_limit - v_device_calls, 0));
end;
$$;

revoke all on function public.reserve_ocr_call(text, int, bigint, numeric, numeric) from public, anon, authenticated;
grant execute on function public.reserve_ocr_call(text, int, bigint, numeric, numeric) to service_role;
