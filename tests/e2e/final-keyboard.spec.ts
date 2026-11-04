// 이 파일이 하는 일: 키보드만으로 핵심 4작업을 끝낼 수 있는지 확인한다(phase-05-task-03 AC4, NFR-007).
// 마우스·click()을 쓰지 않고 Tab·Enter·글자 입력만으로 ① 로그인 ② 재고 출고 ③ AI 문서 생성·저장(데모 AI) ④ 연차 신청을 끝낸다.
// 메뉴 이동도 사이드바 묶음 버튼(Enter로 펼침)과 링크를 Tab으로 찾아 Enter로 연다. 포커스가 --accent 2px 외곽선으로 보이는지도 함께 본다(DESIGN §5-3).
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { expect, test, type IsoServer } from './fixtures.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '한원장', username: 'keyadmin', password: 'Key-Admin-Pass-4', withDemo: true };
const STAFF = { username: 'keystaff', password: 'Key-Staff-Pass-4', name: '정하늘' };
const ACCENT = 'rgb(27, 58, 107)';

let server: IsoServer;
const url = (p: string) => `${server.baseURL}${p}`;

/** 콘솔 오류를 모은다(일부러 만든 4xx 응답 줄은 뺀다) */
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

/** 요소가 지금 포커스를 가졌는지(브라우저 안에서 실행. 서버용 타입 설정에는 DOM 타입이 없어 함수 본문을 글로 만든다) */
const IS_ACTIVE = new Function('el', 'return el === document.activeElement') as (el: unknown) => boolean;

/** target에 포커스가 갈 때까지 Tab을 누른다(최대 max번). 마우스는 쓰지 않는다 */
async function tabTo(page: Page, target: Locator, max = 150): Promise<void> {
  await expect(target).toBeVisible();
  for (let i = 0; i < max; i++) {
    if (await target.evaluate(IS_ACTIVE)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab ${max}번 안에 포커스가 가지 않았어요: ${target.toString()}`);
}

/** 지금 포커스된 요소의 외곽선이 청록 2px인지 */
async function expectFocusRing(page: Page): Promise<void> {
  const ring = await page.evaluate('(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor }; })()');
  expect(ring).toEqual({ style: 'solid', width: '2px', color: ACCENT });
}

/** 사이드바에서 묶음(접혀 있으면 Enter로 펼침) → 링크를 Tab으로 찾아 Enter로 연다 */
async function goByMenu(page: Page, group: string, label: string): Promise<void> {
  const side = page.locator('.side');
  const link = side.getByRole('link', { name: label, exact: true });
  if (!(await link.isVisible())) {
    const head = side.getByRole('button', { name: group, exact: true });
    await tabTo(page, head);
    await page.keyboard.press('Enter');
  }
  await tabTo(page, link);
  await expectFocusRing(page);
  await page.keyboard.press('Enter');
}

/** 로그인 화면에서 키보드만으로 로그인한다 */
async function keyboardLogin(browser: Browser, who: { username: string; password: string }): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await page.goto(url('/login'));
  await expect(page.getByRole('heading', { level: 1, name: '로그인' })).toBeVisible();
  await page.locator('body').focus();
  await tabTo(page, page.getByLabel('아이디'));
  await page.keyboard.type(who.username);
  await tabTo(page, page.getByLabel('비밀번호'));
  await page.keyboard.type(who.password);
  await tabTo(page, page.getByRole('button', { name: '로그인' }));
  await expectFocusRing(page);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(url('/'));
  return { ctx, page, errors };
}

test.describe.serial('키보드만으로 핵심 작업', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test.beforeAll(async ({ request, isoServer }) => {
    expect((await request.post('/api/setup', { data: ADMIN })).status()).toBe(201);
    await isoServer.addUser('staff', STAFF.username, STAFF.password, STAFF.name);
  });

  test('phase-05-task-03 AC4: 키보드만으로 로그인 → 재고 출고 → AI 문서 생성·저장을 끝낸다', async ({ browser }) => {
    test.setTimeout(120000);
    // ① 로그인
    const { ctx, page, errors } = await keyboardLogin(browser, ADMIN);
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(`${ADMIN.name}님`) })).toBeVisible();

    // ② 재고 출고: 메뉴 → "출고 기록" → 품목 찾기 → 고르기 → 수량 → 저장
    await goByMenu(page, '재고·구매', '재고 현황');
    await expect(page.getByRole('heading', { level: 1, name: '재고 현황' })).toBeVisible();
    await tabTo(page, page.getByRole('button', { name: '출고 기록' }));
    await expectFocusRing(page);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '출고 기록' });
    const search = dialog.getByRole('searchbox', { name: '출고할 품목 찾기' });
    await expect(search).toBeFocused();
    await page.keyboard.type('니트릴 글러브 M');
    const pick = dialog.getByRole('button', { name: /^니트릴 글러브 M/ });
    await tabTo(page, pick, 20);
    await page.keyboard.press('Enter');
    const qty = dialog.getByRole('spinbutton', { name: /^출고 수량/ });
    await expect(qty).toBeFocused();
    await page.keyboard.type('1');
    await tabTo(page, dialog.getByRole('button', { name: '저장' }), 20);
    await page.keyboard.press('Enter');
    await expect(page.getByText(/니트릴 글러브 M 1\S+ 출고를 기록했어요/)).toBeVisible();
    await expect(dialog).toHaveCount(0);

    // ③ AI 문서 생성(데모 AI): 메뉴 → 요점 → 초안 만들기 → (편집기로 옮겨짐) → 저장
    await goByMenu(page, '문서·AI', 'AI 문서 작성');
    await expect(page.getByRole('heading', { level: 1, name: 'AI 문서 작성' })).toBeVisible();
    const panel = page.getByTestId('ai-panel-doc_writer');
    await tabTo(page, panel.getByLabel('요점'));
    await page.keyboard.type('스케일링 후 주의사항, 시린 느낌은 며칠 뒤 사라짐, 이상하면 연락');
    await tabTo(page, panel.getByRole('button', { name: '초안 만들기' }));
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('본문')).not.toHaveValue('', { timeout: 20000 });
    await expect(page.getByLabel('제목')).not.toHaveValue('');
    await tabTo(page, page.getByRole('button', { name: '저장', exact: true }));
    await expectFocusRing(page);
    await page.keyboard.press('Enter');
    await expect(page.getByText('서식 보관함에 저장했어요(버전 1).')).toBeVisible();
    await expect(page.getByText('버전 1 저장됨')).toBeVisible();
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-05-task-03 AC4: 직원이 키보드만으로 로그인 → 연차 신청을 끝낸다', async ({ browser }) => {
    test.setTimeout(90000);
    const { ctx, page, errors } = await keyboardLogin(browser, STAFF);
    await goByMenu(page, '인사·근무', '연차·휴가');
    await expect(page.getByRole('heading', { level: 1, name: '연차·휴가' })).toBeVisible();
    await tabTo(page, page.getByRole('button', { name: '휴가 신청', exact: true }));
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '휴가 신청', exact: true });
    await expect(dialog).toBeVisible();
    // 종류는 기본값(연차) 그대로, 날짜는 연도 → (→ 키로 다음 칸) → 월·일 순서로 숫자를 입력한다(한국어 날짜 칸: 연도. 월. 일.)
    await expect(dialog.getByLabel('종류')).toHaveValue('annual');
    await tabTo(page, dialog.getByLabel('시작 날짜'), 20);
    await page.keyboard.type('2026');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('1110');
    await expect(dialog.getByLabel('시작 날짜')).toHaveValue('2026-11-10');
    await tabTo(page, dialog.getByLabel('사유(선택)'), 20);
    await page.keyboard.type('가족 행사');
    await expect(dialog.getByTestId('leave-preview')).toContainText('1일');
    await tabTo(page, dialog.getByRole('button', { name: '신청하기' }), 20);
    await expectFocusRing(page);
    await page.keyboard.press('Enter');
    await expect(page.getByText(/11월 10일\(화\) 연차 신청을 보냈어요/)).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: '11월 10일(화)' });
    await expect(row).toContainText('승인 대기');
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
