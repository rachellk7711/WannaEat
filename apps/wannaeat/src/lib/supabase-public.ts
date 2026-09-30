// 모든 사용자 화면에 들어가는 공개 값이다. 권한은 공개 키가 아니라 서버(RLS·함수)가 지킨다.
// 배포 환경에 환경변수를 빠뜨려도 앱이 서버를 부를 수 있도록 기본값을 둔다.
// 시크릿 키·Gemini 키는 절대 여기에 두지 않는다.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim() || 'https://rnfhcwoqcrdoevabtjku.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || 'sb_publishable_HsxvjDsLUmeu0wfRBX8j-w_wV-hVO5t'
