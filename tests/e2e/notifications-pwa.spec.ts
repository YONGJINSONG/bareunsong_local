// 이 파일이 하는 일: 휴대폰 홈 화면 추가(PWA, FR-091 AC1)를 확인한다(phase-04-task-05 AC2·AC3).
// AC2: 휴대폰 흉내(390×844, 터치·모바일)에서 시작 HTML이 건 매니페스트를 브라우저가 실제로 읽는지(CDP Page.getAppManifest, 오류 0건),
//      이름·짧은 이름·시작 주소·standalone·theme-color(HTML meta와 같음)·아이콘(192·512·maskable, 실제 PNG 크기)이 맞는지 본다.
//      원내 접속이 http라 서비스 워커는 두지 않는다(TD-017) → 등록된 서비스 워커가 없는 것도 확인한다.
// AC3: 데모 데이터를 넣은 서버에서 주요 화면 14개를 390px 라이트·다크로 열어 document.documentElement.scrollWidth ≤ innerWidth(= 390 그대로)인지 잰다.
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test, type IsoServer } from './fixtures.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '한원장', username: 'pwaadmin', password: 'Pwa-Admin-Pass-5', withDemo: true };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const THEME_COLOR = '#1B3A6B';

/** 390px에서 가로 스크롤을 재는 주요 화면(경로와 다 그려졌다고 볼 제목) */
const SCREENS: { path: string; heading: string | RegExp }[] = [
  { path: '/', heading: /\S/ },
  { path: '/notifications', heading: '알림' },
  { path: '/desk/board', heading: '공지·인수인계' },
  { path: '/desk/checklist', heading: '오픈·마감 체크리스트' },
  { path: '/inventory', heading: '재고 현황' },
  { path: '/inventory/orders', heading: '발주서' },
  { path: '/docs/writer', heading: 'AI 문서 작성' },
  { path: '/docs/library', heading: '서식 보관함' },
  { path: '/hr/roster', heading: '근무표' },
  { path: '/hr/leave', heading: '연차·휴가' },
  { path: '/facility/equipment', heading: '장비 점검·유지보수' },
  { path: '/facility/sterilizer', heading: '멸균기 점검 기록' },
  { path: '/facility/legal', heading: '법정 의무 일정' },
  { path: '/finance/expenses', heading: '지출 기록' },
];

let server: IsoServer;
const url = (p: string) => `${server.baseURL}${p}`;

/** 휴대폰 흉내 브라우저 묶음을 만들고 API로 로그인해 둔다 */
async function phone(browser: Browser, colorScheme: 'light' | 'dark' = 'light', login = true): Promise<BrowserContext> {
  const ctx = await browser.newContext({ ...PHONE, colorScheme, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  if (login) {
    const r = await ctx.request.post(url('/api/auth/login'), { data: { username: ADMIN.username, password: ADMIN.password } });
    expect(r.status()).toBe(200);
  }
  return ctx;
}

/** PNG 파일 머리(IHDR)에서 가로·세로 픽셀을 읽는다 */
function pngSize(buf: Buffer): { w: number; h: number } {
  expect(buf.subarray(0, 8).toString('hex'), 'PNG 서명').toBe('89504e470d0a1a0a');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** 지금 화면의 가로 넘침을 잰다 */
async function overflow(page: Page): Promise<{ sw: number; iw: number; wide: string[] }> {
  // 넘친 요소는 휴대폰 너비(390) 기준으로 찾는다(넘치면 innerWidth 자체가 커지므로)
  return (await page.evaluate(`(() => {
    const iw = window.innerWidth;
    const limit = ${PHONE.viewport.width};
    const wide = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > limit + 1 && getComputedStyle(el).position !== 'fixed')
      .slice(0, 5)
      .map((el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : ''));
    return { sw: document.documentElement.scrollWidth, iw, wide };
  })()`)) as { sw: number; iw: number; wide: string[] };
}

/**
 * 390px에 맞는지: scrollWidth ≤ innerWidth이고 innerWidth가 390 그대로여야 한다.
 * 휴대폰 흉내에서는 내용이 넘치면 브라우저가 화면을 축소해 innerWidth가 커지므로 둘을 함께 본다.
 */
function fits(o: { sw: number; iw: number }): boolean {
  return o.iw === PHONE.viewport.width && o.sw <= o.iw;
}

test.describe.serial('휴대폰 홈 화면 추가·390px', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test.beforeAll(async ({ request }) => {
    const r = await request.post('/api/setup', { data: ADMIN });
    expect(r.status()).toBe(201);
  });

  test('phase-04-task-05 AC2: 휴대폰(390×844)에서 매니페스트가 로드되고 이름·아이콘·theme-color가 맞다', async ({ browser }) => {
    const ctx = await phone(browser, 'light', false);
    const page = await ctx.newPage();
    await page.goto(url('/'));
    await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible();
    // 시작 HTML이 거는 것
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBe('/manifest.webmanifest');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', THEME_COLOR);
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', '바른송 AX');

    // 브라우저가 실제로 읽은 매니페스트(Chromium 개발 도구 통로)
    const cdp = await ctx.newCDPSession(page);
    const app = (await cdp.send('Page.getAppManifest')) as { url: string; errors: { message: string }[]; data?: string };
    expect(app.url).toBe(url('/manifest.webmanifest'));
    expect(app.errors.map((e) => e.message)).toEqual([]);
    const m = JSON.parse(app.data ?? '{}') as {
      name: string;
      short_name: string;
      start_url: string;
      scope: string;
      display: string;
      lang: string;
      theme_color: string;
      background_color: string;
      icons: { src: string; sizes: string; type: string; purpose?: string }[];
    };
    expect(m).toMatchObject({ name: '바른송치과 원내 AX', short_name: '바른송 AX', start_url: '/', scope: '/', display: 'standalone', lang: 'ko', theme_color: THEME_COLOR });
    expect(m.background_color).toMatch(/^#[0-9A-Fa-f]{6}$/);

    // 매니페스트 응답 자체
    const res = await ctx.request.get(url('/manifest.webmanifest'));
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/manifest\+json|application\/json/);

    // 아이콘: 192·512(any)와 maskable 512가 실제 그 크기의 PNG로 내려온다
    expect(m.icons.map((i) => `${i.sizes}:${i.purpose ?? 'any'}`).sort()).toEqual(['192x192:any', '512x512:any', '512x512:maskable']);
    for (const icon of m.icons) {
      const r = await ctx.request.get(url(icon.src));
      expect(r.status(), icon.src).toBe(200);
      expect(r.headers()['content-type'], icon.src).toBe('image/png');
      const { w, h } = pngSize(await r.body());
      expect(`${w}x${h}`, icon.src).toBe(icon.sizes);
    }
    const apple = await ctx.request.get(url((await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')) ?? ''));
    expect(apple.status()).toBe(200);
    expect(pngSize(await apple.body()).w).toBeGreaterThanOrEqual(180);

    // http 원내 주소라 서비스 워커는 없다(TD-017)
    expect(await page.evaluate('navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then((r) => r.length) : 0')).toBe(0);
    await ctx.close();
  });

  test('phase-04-task-05 AC3: 측정 방법 확인 — 일부러 넓은 요소를 넣으면 390px 측정이 넘침을 잡는다', async ({ browser }) => {
    // 모바일 흉내에서 넘치는 화면이 축소돼 측정이 헛돌지 않는지 먼저 확인한다
    const ctx = await phone(browser);
    const page = await ctx.newPage();
    await page.goto(url('/notifications'));
    await expect(page.getByRole('heading', { level: 1, name: '알림' })).toBeVisible();
    const before = await overflow(page);
    expect(fits(before), JSON.stringify(before)).toBe(true);
    await page.evaluate(`(() => { const d = document.createElement('div'); d.id = 'wide-probe'; d.setAttribute('aria-hidden', 'true'); d.textContent = '넓은 시험 상자'; d.style.width = '640px'; document.querySelector('main')?.appendChild(d); })()`);
    const after = await overflow(page);
    // 모바일 브라우저는 넘치면 화면을 축소해 innerWidth까지 커진다(그래서 390 고정도 함께 본다)
    expect(fits(after), JSON.stringify(after)).toBe(false);
    expect(after.wide.join(' ')).toContain('div');
    await ctx.close();
  });

  for (const s of SCREENS) {
    test(`phase-04-task-05 AC3: 390px ${s.path} 화면에 가로 스크롤이 없다(라이트·다크)`, async ({ browser }) => {
      for (const theme of ['light', 'dark'] as const) {
        const ctx = await phone(browser, theme);
        const page = await ctx.newPage();
        await page.goto(url(s.path));
        await expect(page.getByRole('heading', { level: 1, name: s.heading })).toBeVisible();
        await page.waitForLoadState('networkidle');
        const o = await overflow(page);
        expect(fits(o), `${s.path} ${theme} scrollWidth ${o.sw} / innerWidth ${o.iw}, 넘친 요소: ${o.wide.join(', ')}`).toBe(true);
        await ctx.close();
      }
    });
  }
});
