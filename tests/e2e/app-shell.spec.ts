// 이 파일이 하는 일: 앱 셸·첫 설정/로그인 화면 E2E(phase-01-task-04 AC1~AC6). 이 파일 전용 격리 서버(tests/e2e/fixtures.ts의 isoServer, 새 임시 데이터 폴더)에서
// 첫 설정 → 대시보드 셸 → 로그아웃 → 로그인(AC1), 4너비×2테마 가로 스크롤·겹침 없음(AC2), staff 메뉴 숨김·권한 없음 안내(AC3),
// axe 위반 0건과 Tab 키만으로 로그인(AC4), 외부 요청 차단 상태의 Pretendard 적용(AC5), 서버 정지·재시작 때 연결 끊김 띠(AC6)를 확인한다.
// 모든 화면에서 콘솔 오류(CSP 위반 포함)가 없어야 한다. 테스트는 이 파일 안 순서대로 실행된다(serial).
import type { Browser, BrowserContext, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type IsoServer } from './fixtures.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '김원장', username: 'shelladmin', password: 'Shell-Admin-Pass-7' };
const STAFF = { name: '이수진', username: 'shellstaff', password: 'Shell-Staff-Pass-7' };
const WIDTHS: Array<[number, number]> = [[1440, 900], [1024, 768], [768, 1024], [390, 844]];
const THEMES = ['light', 'dark'] as const;

// 브라우저 안에서 계산하는 코드는 문자열로 넘긴다(서버용 타입 설정 tsconfig.server.json에는 DOM 타입이 없음)

/** 셸 모양 측정: 가로 스크롤, 메뉴·아래쪽 탭 표시, 상단바 요소 겹침, 본문 밖으로 나간 카드 수, 바탕색, 테마 */
const SHELL_PROBE = `(() => {
  const r = (el) => (el ? el.getBoundingClientRect() : null);
  const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const topKids = [...document.querySelectorAll('.top > *')].filter(vis).map((e) => e.getBoundingClientRect());
  const wrap = r(document.querySelector('.wrap'));
  const boxes = [...document.querySelectorAll('.kpi, .card, .pagehead')].map((e) => e.getBoundingClientRect());
  const side = document.querySelector('.side');
  return {
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    sideWidth: side ? side.getBoundingClientRect().width : 0,
    sideVisible: !!side && getComputedStyle(side).display !== 'none',
    bottomVisible: getComputedStyle(document.querySelector('.bottomnav')).display !== 'none',
    topOverlap: topKids.some((a, i) => topKids.some((b, j) => j > i && a.left < b.right - 0.5 && b.left < a.right - 0.5)),
    outside: wrap ? boxes.filter((b) => b.left < wrap.left - 0.5 || b.right > wrap.right + 0.5).length : -1,
    bg: getComputedStyle(document.body).backgroundColor,
    theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  };
})()`;
interface ShellProbe {
  scrollWidth: number;
  innerWidth: number;
  sideWidth: number;
  sideVisible: boolean;
  bottomVisible: boolean;
  topOverlap: boolean;
  outside: number;
  bg: string;
  theme: string;
}

/** 글꼴 측정: body·h1의 font-family, Pretendard 확인, Pretendard 글꼴 면의 로드 상태 */
const FONT_PROBE = `(async () => {
  await document.fonts.ready;
  const faces = [...document.fonts].filter((x) => x.family.replace(/"/g, '') === 'Pretendard Variable');
  return {
    bodyFamily: getComputedStyle(document.body).fontFamily,
    h1Family: getComputedStyle(document.querySelector('h1')).fontFamily,
    check: document.fonts.check('14px "Pretendard Variable"', '가나다'),
    statuses: faces.map((x) => x.status),
  };
})()`;

/** 이 파일의 격리 서버(테스트마다 beforeEach에서 받는다. 파일 안 테스트는 모두 같은 서버) */
let server: IsoServer;
const url = (p: string) => `${server.baseURL}${p}`;

/**
 * 페이지의 콘솔 오류·스크립트 오류(CSP 위반 "Refused to ..." 포함)를 모은다.
 * 시험이 일부러 만든 4xx 응답(틀린 비밀번호 401 등)을 브라우저가 남기는 "Failed to load resource" 줄만 뺀다.
 */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) return;
    errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** axe 위반 목록을 "규칙: 위치, 위치" 글줄로 바꾼다(실패 메시지에서 어디가 문제인지 바로 보이게) */
function axeList(violations: Array<{ id: string; nodes: Array<{ target: unknown[] }> }>): string[] {
  return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** 새 브라우저 묶음을 만들고 API로 로그인해 둔다 */
async function loggedIn(browser: Browser, who: { username: string; password: string }, opts: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...opts });
  const r = await ctx.request.post(url('/api/auth/login'), { data: { username: who.username, password: who.password } });
  expect(r.status()).toBe(200);
  return ctx;
}

test.describe.serial('앱 셸·첫 설정·로그인', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test('phase-01-task-04 AC1: 새 서버에서 /setup으로 관리자를 만들면 대시보드 셸이 보이고, 로그아웃 → 로그인이 된다', async ({ page }) => {
    const errors = watchErrors(page);
    // 아무 주소로 들어가도 첫 설정 화면으로 간다(FR-001 AC1)
    await page.goto(url('/inventory'));
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole('heading', { level: 1, name: '첫 설정' })).toBeVisible();

    // 비밀번호 확인이 틀리면 입력란에 연결된 오류가 보인다
    await page.getByLabel('병원 이름').fill(ADMIN.clinicName);
    await page.getByLabel('관리자 이름').fill(ADMIN.name);
    await page.getByLabel('아이디').fill(ADMIN.username);
    await page.getByLabel(/^비밀번호\s*\*?$/).fill(ADMIN.password);
    await page.getByLabel('비밀번호 확인').fill('different-1234');
    await page.getByRole('button', { name: '설정 마치고 시작하기' }).click();
    const confirm = page.getByLabel('비밀번호 확인');
    await expect(confirm).toHaveAttribute('aria-invalid', 'true');
    await expect(confirm).toHaveAccessibleDescription(/비밀번호 확인이 맞지 않아요/);

    await confirm.fill(ADMIN.password);
    await page.getByRole('button', { name: '설정 마치고 시작하기' }).click();
    await expect(page).toHaveURL(url('/'));
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(`${ADMIN.name}님`) })).toBeVisible();
    const nav = page.getByRole('navigation', { name: '주 메뉴' });
    await expect(nav).toBeVisible();
    for (const g of ['데스크·소통', '재고·구매', '문서·AI', '인사·근무', '시설·법정', '운영 지표', '관리']) {
      await expect(nav.getByRole('button', { name: g })).toBeVisible();
    }
    await expect(page.getByRole('banner')).toContainText(ADMIN.clinicName);
    // 브라우저 탭 제목도 입력한 병원 이름을 쓴다(데모 병원 이름 고정 아님)
    await expect(page).toHaveTitle(`${ADMIN.clinicName} 원내 AX`);
    await expect(page.getByRole('region', { name: '요약 숫자' })).toBeVisible();
    await expect(page.getByRole('region', { name: '오늘 현황' })).toBeVisible();

    // 설정이 끝난 뒤 /setup은 대시보드로 돌려보낸다(FR-001 AC2)
    await page.goto(url('/setup'));
    await expect(page).toHaveURL(url('/'));

    // 로그아웃 → 로그인 화면
    await page.getByRole('button', { name: `${ADMIN.name} 원장·관리자 메뉴` }).click();
    await page.getByRole('button', { name: '로그아웃' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { level: 1, name: '로그인' })).toBeVisible();
    // 로그아웃 뒤 업무 화면 주소로 가면 로그인으로 보내면서 원래 주소를 기억한다
    await page.goto(url('/hr/leave'));
    await expect(page).toHaveURL(/\/login\?next=%2Fhr%2Fleave$/);

    // 틀린 비밀번호는 서버 문구만 보여 준다(FR-002 AC1)
    await page.getByLabel('아이디').fill(ADMIN.username);
    await page.getByLabel('비밀번호').fill('wrong-password-1');
    await page.getByRole('button', { name: '로그인' }).click();
    await expect(page.getByRole('alert')).toHaveText('아이디 또는 비밀번호가 맞지 않습니다.');

    await page.getByLabel('비밀번호').fill(ADMIN.password);
    await page.getByRole('button', { name: '로그인' }).click();
    await expect(page).toHaveURL(url('/hr/leave'));
    await expect(page.getByRole('heading', { level: 1, name: '연차·휴가' })).toBeVisible();
    await page.getByRole('link', { name: '대시보드' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(`${ADMIN.name}님`) })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('phase-01-task-04 AC3: staff 사이드바에는 관리 묶음이 없고, /admin/users로 바로 가면 권한 없음 안내가 보인다', async ({ browser }) => {
    await server.addUser('staff', STAFF.username, STAFF.password, STAFF.name);
    const ctx = await loggedIn(browser, STAFF, { viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/'));
    const nav = page.getByRole('navigation', { name: '주 메뉴' });
    await expect(nav.getByRole('button', { name: '재고·구매' })).toBeVisible();
    await expect(nav.getByRole('button', { name: '관리' })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: '운영 지표' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: '사용자·권한' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: '발주서' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: '재고 현황' })).toBeVisible();

    await page.goto(url('/admin/users'));
    await expect(page.getByRole('heading', { level: 1, name: '권한 없음' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('이 화면을 볼 권한이 없어요');
    // 휴대폰 "더보기" 전체 메뉴에도 관리 묶음이 없다
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '더보기' }).click();
    const more = page.getByRole('navigation', { name: '전체 메뉴' });
    await expect(more.getByRole('link', { name: '재고 현황' })).toBeVisible();
    await expect(more.getByText('관리', { exact: true })).toHaveCount(0);
    await expect(more.getByRole('link', { name: '사용자·권한' })).toHaveCount(0);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-01-task-04 AC2: 셸이 1440·1024·768·390px × 라이트·다크에서 가로 스크롤·겹침 없이 맞는 모양으로 보인다', async ({ browser }) => {
    for (const [width, height] of WIDTHS) {
      for (const theme of THEMES) {
        const label = `${width}-${theme}`;
        const ctx = await loggedIn(browser, ADMIN, { viewport: { width, height }, colorScheme: theme });
        const page = await ctx.newPage();
        const errors = watchErrors(page);
        await page.goto(url('/'));
        await expect(page.getByRole('region', { name: '오늘 현황' }), label).toBeVisible();
        await page.evaluate('document.fonts.ready');
        const m = (await page.evaluate(SHELL_PROBE)) as ShellProbe;
        expect(m.innerWidth, `${label} 창 너비 그대로`).toBe(width);
        expect(m.scrollWidth, `${label} 가로 스크롤`).toBeLessThanOrEqual(m.innerWidth);
        expect(m.topOverlap, `${label} 상단바 겹침`).toBe(false);
        expect(m.outside, `${label} 카드가 본문 밖으로`).toBe(0);
        expect(m.theme).toBe(theme);
        expect(m.bg, `${label} 바탕색`).toBe(theme === 'dark' ? 'rgb(13, 17, 24)' : 'rgb(244, 246, 249)');
        if (width > 1100) {
          expect(Math.round(m.sideWidth), `${label} 메뉴 폭`).toBe(232);
          expect(m.bottomVisible).toBe(false);
        } else if (width > 720) {
          expect(Math.round(m.sideWidth), `${label} 아이콘 막대 폭`).toBe(64);
          expect(m.bottomVisible).toBe(false);
        } else {
          expect(m.sideVisible, `${label} 휴대폰 메뉴 숨김`).toBe(false);
          expect(m.bottomVisible, `${label} 아래쪽 탭`).toBe(true);
        }
        expect(errors, label).toEqual([]);
        await ctx.close();
      }
    }
  });

  // axe 검사는 한 번에 1~5초 걸린다(PC 부하에 따라 다름). 예전에는 10번을 테스트 하나에 몰아 30초 제한을 부하가 클 때 넘겼다
  // (2026-11-02 통합 실패: 화면은 0.3초 안에 떴는데 시간 제한에 걸려 이동 중에 끊김). 검사 대상·기준은 그대로 두고 테마·화면별 테스트로 나눈다.
  for (const theme of THEMES) {
    test(`phase-01-task-04 AC4: 로그인 화면(${theme}) axe 위반이 0건이다`, async ({ browser }) => {
      const anon = await browser.newContext({ colorScheme: theme, viewport: { width: 1440, height: 900 } });
      const p1 = await anon.newPage();
      await p1.goto(url('/login'));
      await expect(p1.getByRole('heading', { level: 1, name: '로그인' })).toBeVisible();
      const r1 = await new AxeBuilder({ page: p1 }).analyze();
      expect(axeList(r1.violations), `로그인 ${theme}`).toEqual([]);
      await anon.close();
    });

    for (const [width, height] of [[1440, 900], [390, 844]] as const) {
      test(`phase-01-task-04 AC4: 셸 화면(${width}px ${theme}) axe 위반이 0건이다`, async ({ browser }) => {
        const ctx = await loggedIn(browser, ADMIN, { colorScheme: theme, viewport: { width, height } });
        const p2 = await ctx.newPage();
        await p2.goto(url('/'));
        await expect(p2.getByRole('region', { name: '오늘 현황' })).toBeVisible();
        const r2 = await new AxeBuilder({ page: p2 }).analyze();
        expect(axeList(r2.violations), `셸 ${width} ${theme}`).toEqual([]);
        // 준비 중(스텁) 화면 검사는 지웠다: 2026-11-03 모든 화면이 실제 화면이 되어 StubPage를 쓰는 경로가 없다. 각 화면의 axe는 그 화면의 spec이 검사한다.
        await ctx.close();
      });
    }
  }

  test('phase-01-task-04 AC4: 마우스 없이 Tab 키만으로 로그인을 끝낼 수 있고 포커스가 청록 2px 외곽선으로 보인다', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(url('/login'));
    await expect(page.getByRole('heading', { level: 1, name: '로그인' })).toBeVisible();
    await page.locator('body').focus();
    // Tab으로 아이디 칸까지 간다(아이디 칸이 처음 포커스를 받으면 그대로)
    for (let i = 0; i < 5; i++) {
      if ((await page.evaluate("document.activeElement?.getAttribute('autocomplete')")) === 'username') break;
      await page.keyboard.press('Tab');
    }
    await expect(page.getByLabel('아이디')).toBeFocused();
    await page.keyboard.type(ADMIN.username);
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('비밀번호')).toBeFocused();
    await page.keyboard.type(ADMIN.password);
    await page.keyboard.press('Tab');
    const btn = page.getByRole('button', { name: '로그인' });
    await expect(btn).toBeFocused();
    const ring = await page.evaluate(
      `(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor }; })()`,
    );
    expect(ring).toEqual({ style: 'solid', width: '2px', color: 'rgb(27, 58, 107)' });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(url('/'));
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(`${ADMIN.name}님`) })).toBeVisible();
    await ctx.close();
  });

  test('phase-01-task-04 AC5: 외부 요청을 모두 막아도 Pretendard 글꼴이 로드되고 적용된다', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const external: string[] = [];
    await ctx.route('**/*', (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host === 'localhost' || host === '127.0.0.1') return route.continue();
      external.push(route.request().url());
      return route.abort('internetdisconnected');
    });
    const page = await ctx.newPage();
    const fontRes = page.waitForResponse((r) => r.url().endsWith('/fonts/PretendardVariable.woff2'));
    await page.goto(url('/login'));
    expect((await fontRes).status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: '로그인' })).toBeVisible();
    const f = (await page.evaluate(FONT_PROBE)) as { bodyFamily: string; h1Family: string; check: boolean; statuses: string[] };
    expect(f.bodyFamily.startsWith('"Pretendard Variable"')).toBe(true);
    expect(f.h1Family.startsWith('"Pretendard Variable"')).toBe(true);
    expect(f.check).toBe(true);
    expect(f.statuses).toContain('loaded');
    expect(external).toEqual([]);
    await ctx.close();
  });

  test('phase-01-task-04 AC6: 서버를 멈추면 "원내 와이파이 연결 확인" 띠가 나타나고, 다시 켜면 사라진다', async ({ browser }) => {
    test.setTimeout(120000);
    const ctx = await loggedIn(browser, ADMIN, { viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(url('/'));
    await expect(page.getByRole('region', { name: '오늘 현황' })).toBeVisible();
    const banner = page.getByTestId('offline-banner');
    await expect(banner).toHaveCount(0);

    await server.stop();
    await expect(banner).toBeVisible({ timeout: 30000 });
    await expect(banner).toContainText('원내 와이파이 연결 확인');
    await expect(banner).toContainText('원내 와이파이에 연결되어 있는지 확인하세요');

    await server.start();
    await expect(banner).toHaveCount(0, { timeout: 30000 });
    // 다시 연결된 뒤에도 로그인 상태 그대로 화면을 쓸 수 있다(주 메뉴의 "재고 현황". 대시보드 빈 상태의 "재고 현황 보기" 버튼과 구분, phase-03-task-10)
    await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('link', { name: '재고 현황', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: '재고 현황' })).toBeVisible();
    await ctx.close();
  });
});
