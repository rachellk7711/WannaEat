-- 무료 프로젝트는 일주일 동안 데이터베이스 요청이 없으면 멈춘다.
-- GitHub Actions 가 이틀마다 이 함수를 불러 깨워 둔다(.github/workflows/supabase-keepalive.yml).
-- 현재 시각만 돌려주므로 공개 키로 불러도 드러나는 정보가 없다.
create or replace function public.keepalive()
returns timestamptz
language sql
stable
as $$ select now() $$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated, service_role;
