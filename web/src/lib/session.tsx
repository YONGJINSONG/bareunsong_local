// 이 파일이 하는 일: 로그인 상태(GET /api/session 결과)를 앱 전체에 나눠 준다(SessionProvider·useSession).
// 첫 설정 필요 여부·로그인한 사용자·CSRF 토큰·병원 이름·데모 여부를 들고 있고, 로그인/첫 설정 성공·로그아웃·세션 만료(401)를 처리한다.
// 세션이 만료되면 로그인 화면으로 보내면서 원래 주소를 ?next=로 넘기고, 로그인하면 그 주소로 돌아간다(frontend.md §4). next는 같은 사이트 경로만 허용한다.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { LoginResult, SessionInfo } from '../../../shared/schemas/auth.ts';
import { api, setCsrfToken, setUnauthorizedHandler } from './api.ts';
import { clearApiCache } from './useApi.ts';

/**
 * ?next= 값이 안전한 같은 사이트 경로인지 확인하고, 아니면 '/'를 돌려준다.
 * '//다른사이트'·'http://...'·'/\\..' 같은 바깥 주소와 로그인·설정 화면 자신은 막는다.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || typeof next !== 'string') return '/';
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (/^\/(login|setup|change-password)(\/|\?|$)/.test(next)) return '/';
  return next;
}

/** 로그인 화면 주소(돌아올 경로 포함) */
export function loginPath(next?: string | null): string {
  const n = next ? safeNext(next) : '/';
  return n === '/' ? '/login' : `/login?next=${encodeURIComponent(n)}`;
}

interface SessionApi {
  /** 세션 정보(처음 불러오기 전에는 null) */
  info: SessionInfo | null;
  /** 처음 불러오기에 실패했을 때의 오류 */
  error: Error | null;
  /** 세션 정보를 다시 불러온다 */
  refresh: () => Promise<void>;
  /** 로그인·첫 설정 성공 결과를 반영한다 */
  signedIn: (r: LoginResult, extra?: Partial<SessionInfo>) => void;
  /** 비밀번호를 바꾼 뒤(임시 비밀번호 해제) 반영한다 */
  passwordChanged: () => void;
  /** 로그아웃한다(서버 세션 삭제 → 로그인 화면) */
  logout: () => Promise<void>;
  /** 세션 만료로 로그인 화면에 왔는지(안내 문구용) */
  expired: boolean;
}

const Ctx = createContext<SessionApi | null>(null);

/** 로그인 상태를 불러와 앱에 나눠 준다. BrowserRouter 안에 둔다 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [expired, setExpired] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const locRef = useRef(location);
  useEffect(() => {
    locRef.current = location;
  });

  const refresh = useCallback(async () => {
    try {
      const s = await api.get<SessionInfo>('/api/session');
      setCsrfToken(s.csrfToken);
      setInfo(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api.get<SessionInfo>('/api/session').then(
      (s) => {
        if (!alive) return;
        setCsrfToken(s.csrfToken);
        setInfo(s);
      },
      (e: unknown) => {
        if (alive) setError(e instanceof Error ? e : new Error(String(e)));
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  // 브라우저 탭 제목: 첫 설정 전에는 "바른송치과 원내 AX", 병원 이름이 정해지면 "<병원 이름> 원내 AX"
  const clinicName = info?.clinicName?.trim() || null;
  useEffect(() => {
    document.title = clinicName ? `${clinicName} 원내 AX` : '바른송치과 원내 AX';
  }, [clinicName]);

  // 다른 API가 401을 받으면: 로그인 상태를 지우고 원래 주소를 들고 로그인 화면으로
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setCsrfToken(null);
      clearApiCache();
      setInfo((prev) => (prev ? { ...prev, user: null, csrfToken: null } : prev));
      setExpired(true);
      const loc = locRef.current;
      navigate(loginPath(`${loc.pathname}${loc.search}`), { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  const signedIn = useCallback((r: LoginResult, extra: Partial<SessionInfo> = {}) => {
    setCsrfToken(r.csrfToken);
    setExpired(false);
    setInfo((prev) => ({
      setupRequired: false,
      clinicName: prev?.clinicName ?? null,
      demoMode: prev?.demoMode ?? false,
      ...extra,
      user: r.user,
      csrfToken: r.csrfToken,
    }));
  }, []);

  const passwordChanged = useCallback(() => {
    setInfo((prev) => (prev?.user ? { ...prev, user: { ...prev.user, mustChangePw: false } } : prev));
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // 이미 만료됐거나 연결이 끊겨도 화면에서는 로그아웃한다
    }
    setCsrfToken(null);
    clearApiCache();
    setExpired(false);
    setInfo((prev) => (prev ? { ...prev, user: null, csrfToken: null } : prev));
    navigate('/login', { replace: true });
  }, [navigate]);

  const value = useMemo<SessionApi>(
    () => ({ info, error, refresh, signedIn, passwordChanged, logout, expired }),
    [info, error, refresh, signedIn, passwordChanged, logout, expired],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 로그인 상태를 읽는다 */
export function useSession(): SessionApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('SessionProvider 안에서만 쓸 수 있어요.');
  return v;
}
