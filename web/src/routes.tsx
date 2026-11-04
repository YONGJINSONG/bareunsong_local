// 이 파일이 하는 일: 화면 경로 표(frontend.md §3 전체)와 접근 규칙. 첫 설정 전이면 /setup, 로그인 전이면 /login?next=원래주소, 임시 비밀번호면 /change-password로 보낸다.
// 업무 화면은 AppShell 안에, 인쇄 화면(/print/*)은 셸 없이 연다. 권한이 없는 화면 주소로 직접 들어오면 "권한 없음" 안내를 보여 준다(shared/roles.ts canSeePage).
// 모듈 페이지는 처음 열 때 불러온다(lazy). 이 파일은 01-04 소유다. 모듈 태스크는 pages/ 아래 자기 페이지 파일만 바꾼다(PLAN.md §3).
import { createElement, lazy, Suspense, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useSearchParams } from 'react-router';
import { canSeePage } from '../../shared/roles.ts';
import { AppShell } from './layout/AppShell.tsx';
import { ErrorState, Skeleton } from './components/States.tsx';
import { loginPath, safeNext, useSession } from './lib/session.tsx';
import DashboardPage from './pages/DashboardPage.tsx';
import SetupPage from './pages/auth/SetupPage.tsx';
import LoginPage from './pages/auth/LoginPage.tsx';
import ChangePasswordPage from './pages/auth/ChangePasswordPage.tsx';
import { ForbiddenNotice, NotFoundPage } from './pages/StubPage.tsx';

type PageModule = { default: ComponentType };

/** 경로 하나: 주소 패턴과 페이지 파일 불러오기 */
export interface RouteDef {
  path: string;
  load: () => Promise<PageModule>;
}

/** AppShell 안에서 여는 업무 화면(대시보드 '/'는 따로 등록) */
export const SHELL_ROUTES: readonly RouteDef[] = [
  { path: '/desk/board', load: () => import('./pages/desk/BoardPage.tsx') },
  { path: '/desk/board/:id', load: () => import('./pages/desk/BoardDetailPage.tsx') },
  { path: '/desk/checklist', load: () => import('./pages/desk/ChecklistPage.tsx') },
  { path: '/desk/script', load: () => import('./pages/desk/ScriptPage.tsx') },
  { path: '/desk/review', load: () => import('./pages/desk/ReviewPage.tsx') },
  { path: '/desk/templates', load: () => import('./pages/desk/TemplatesPage.tsx') },
  { path: '/inventory', load: () => import('./pages/inventory/InventoryPage.tsx') },
  { path: '/inventory/items/:id', load: () => import('./pages/inventory/ItemDetailPage.tsx') },
  { path: '/inventory/moves', load: () => import('./pages/inventory/MovesPage.tsx') },
  { path: '/inventory/receipt', load: () => import('./pages/inventory/ReceiptPage.tsx') },
  { path: '/inventory/orders', load: () => import('./pages/inventory/OrdersPage.tsx') },
  { path: '/inventory/orders/:id', load: () => import('./pages/inventory/OrderDetailPage.tsx') },
  { path: '/inventory/vendors', load: () => import('./pages/inventory/VendorsPage.tsx') },
  { path: '/inventory/prices', load: () => import('./pages/inventory/PricesPage.tsx') },
  { path: '/inventory/import', load: () => import('./pages/inventory/ImportPage.tsx') },
  { path: '/docs/writer', load: () => import('./pages/docs/WriterPage.tsx') },
  { path: '/docs/assistant', load: () => import('./pages/docs/AssistantPage.tsx') },
  { path: '/docs/minutes', load: () => import('./pages/docs/MinutesPage.tsx') },
  { path: '/docs/adcheck', load: () => import('./pages/docs/AdcheckPage.tsx') },
  { path: '/docs/promo', load: () => import('./pages/docs/PromoPage.tsx') },
  { path: '/docs/library', load: () => import('./pages/docs/LibraryPage.tsx') },
  { path: '/docs/library/:id', load: () => import('./pages/docs/LibraryDetailPage.tsx') },
  { path: '/hr/roster', load: () => import('./pages/hr/RosterPage.tsx') },
  { path: '/hr/leave', load: () => import('./pages/hr/LeavePage.tsx') },
  { path: '/hr/attendance', load: () => import('./pages/hr/AttendancePage.tsx') },
  { path: '/hr/training', load: () => import('./pages/hr/TrainingPage.tsx') },
  { path: '/hr/onboarding', load: () => import('./pages/hr/OnboardingPage.tsx') },
  { path: '/hr/hiring', load: () => import('./pages/hr/HiringPage.tsx') },
  { path: '/facility/equipment', load: () => import('./pages/facility/EquipmentPage.tsx') },
  { path: '/facility/sterilizer', load: () => import('./pages/facility/SterilizerPage.tsx') },
  { path: '/facility/legal', load: () => import('./pages/facility/LegalPage.tsx') },
  { path: '/finance/expenses', load: () => import('./pages/finance/ExpensesPage.tsx') },
  { path: '/finance/monthly', load: () => import('./pages/finance/MonthlyPage.tsx') },
  { path: '/admin/users', load: () => import('./pages/admin/UsersPage.tsx') },
  { path: '/admin/clinic', load: () => import('./pages/admin/ClinicPage.tsx') },
  { path: '/admin/ai', load: () => import('./pages/admin/AiSettingsPage.tsx') },
  { path: '/admin/ai-usage', load: () => import('./pages/admin/AiUsagePage.tsx') },
  { path: '/admin/backup', load: () => import('./pages/admin/BackupPage.tsx') },
  { path: '/admin/audit', load: () => import('./pages/admin/AuditPage.tsx') },
  { path: '/admin/reset', load: () => import('./pages/admin/ResetPage.tsx') },
  { path: '/notifications', load: () => import('./pages/NotificationsPage.tsx') },
];

/** 셸 없이 여는 인쇄 전용 화면(기간은 ?from&to 쿼리로 받는다) */
export const PRINT_ROUTES: readonly RouteDef[] = [
  { path: '/print/order/:id', load: () => import('./pages/print/PrintOrderPage.tsx') },
  { path: '/print/document/:id', load: () => import('./pages/print/PrintDocumentPage.tsx') },
  { path: '/print/checklist/:kind/:date', load: () => import('./pages/print/PrintChecklistPage.tsx') },
  { path: '/print/roster', load: () => import('./pages/print/PrintRosterPage.tsx') },
  { path: '/print/sterilizer', load: () => import('./pages/print/PrintSterilizerPage.tsx') },
  { path: '/print/equipment/:id', load: () => import('./pages/print/PrintEquipmentPage.tsx') },
];

/** 셸 없이 여는 인증 화면 */
export const AUTH_PATHS = ['/setup', '/login', '/change-password'] as const;

/** 경로 → 처음 열 때 불러오는 페이지 요소(모듈을 읽을 때 한 번만 만든다) */
const LAZY_PAGES = new Map<string, ReactElement>([...SHELL_ROUTES, ...PRINT_ROUTES].map((r) => [r.path, createElement(lazy(r.load))]));

/** 페이지 파일을 불러오는 동안 뼈대를 보여 준다 */
function LazyPage({ path }: { path: string }) {
  const page = LAZY_PAGES.get(path);
  if (!page) return <NotFoundPage />;
  return <Suspense fallback={<Skeleton rows={6} label="화면 불러오는 중" />}>{page}</Suspense>;
}

/** 세션 정보를 처음 불러오는 동안·실패했을 때 보여 줄 화면 */
function SessionLoading({ children }: { children: ReactNode }) {
  const { info, error, refresh } = useSession();
  if (info) return <>{children}</>;
  return (
    <main className="auth" id="main">
      <div className="auth-card">
        {error ? <ErrorState title="서버에 연결하지 못했어요" message={error.message} onRetry={() => void refresh()} /> : <Skeleton rows={4} label="불러오는 중" />}
      </div>
    </main>
  );
}

/** 로그인이 필요한 화면 감싸기. allowMustChange면 임시 비밀번호 사용자도 들어온다 */
function RequireAuth({ children, allowMustChange = false }: { children: ReactNode; allowMustChange?: boolean }) {
  const { info } = useSession();
  const loc = useLocation();
  if (!info) return null;
  if (info.setupRequired) return <Navigate to="/setup" replace />;
  if (!info.user) return <Navigate to={loginPath(`${loc.pathname}${loc.search}`)} replace />;
  if (info.user.mustChangePw && !allowMustChange) return <Navigate to="/change-password" replace />;
  return <>{children}</>;
}

/** 권한이 없는 화면이면 "권한 없음" 안내 */
function PageGate({ children }: { children: ReactNode }) {
  const { info } = useSession();
  const { pathname } = useLocation();
  if (!canSeePage(info?.user?.role, pathname)) return <ForbiddenNotice />;
  return <>{children}</>;
}

/** 셸 화면 틀 */
function ShellLayout() {
  const { info, logout } = useSession();
  if (!info?.user) return null;
  return (
    <AppShell user={info.user} clinicName={info.clinicName} demoMode={info.demoMode} onLogout={() => void logout()}>
      <PageGate>
        <Outlet />
      </PageGate>
    </AppShell>
  );
}

/** /setup: 첫 설정이 끝났으면 로그인(또는 대시보드)으로 */
function SetupGate() {
  const { info } = useSession();
  if (!info) return null;
  if (!info.setupRequired) return <Navigate to={info.user ? '/' : '/login'} replace />;
  return <SetupPage />;
}

/** /login: 첫 설정 전이면 /setup, 이미 로그인했으면 원래 가려던 곳으로 */
function LoginGate() {
  const { info } = useSession();
  const [params] = useSearchParams();
  if (!info) return null;
  if (info.setupRequired) return <Navigate to="/setup" replace />;
  if (info.user) return <Navigate to={info.user.mustChangePw ? '/change-password' : safeNext(params.get('next'))} replace />;
  return <LoginPage />;
}

/** 앱 전체 경로 */
export function AppRoutes() {
  return (
    <SessionLoading>
      <Routes>
        <Route path="/setup" element={<SetupGate />} />
        <Route path="/login" element={<LoginGate />} />
        <Route
          path="/change-password"
          element={
            <RequireAuth allowMustChange>
              <ChangePasswordPage />
            </RequireAuth>
          }
        />
        {PRINT_ROUTES.map((r) => (
          <Route
            key={r.path}
            path={r.path}
            element={
              <RequireAuth>
                <PageGate>
                  <LazyPage path={r.path} />
                </PageGate>
              </RequireAuth>
            }
          />
        ))}
        <Route
          element={
            <RequireAuth>
              <ShellLayout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          {SHELL_ROUTES.map((r) => (
            <Route key={r.path} path={r.path} element={<LazyPage path={r.path} />} />
          ))}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </SessionLoading>
  );
}
