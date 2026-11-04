// 이 파일이 하는 일: 출퇴근 기록 화면 E2E(바른송 추가 기능 D-B01). 이 파일 전용 격리 서버(fixtures.ts, TEST_NOW 2026-11-02 09:00 고정)에서
// 직원이 출퇴근 화면에서 "출근하기"를 누르면 출근 시각이 보이고 버튼이 "퇴근하기"로 바뀌는지, 대시보드에도 같은 상태가 보이는지,
// 직원에게는 전 직원 기록·CSV·설정이 없는지, 실장이 "기록 넣기"로 사유와 함께 지난달 기록을 넣으면 지난달 표에 "고침"으로 보이는지,
// 원장이 출퇴근 설정에서 와이파이 대역을 저장할 수 있는지(틀린 대역은 칸 아래 오류) 본다. axe 위반 0건과 휴대폰 너비 가로 스크롤 없음도 확인한다.
// 허용 대역 밖 기기 차단은 브라우저가 이 PC(루프백)에서 접속해 늘 허용되므로 단위 테스트(attendance.test.ts)가 맡는다.
import AxeBuilder from '@axe-core/playwright';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test, type IsoServer } from './fixtures.ts';
import { expectNoHorizontalScroll } from './layout.ts';

const ADMIN = { clinicName: '바른송치과의원', name: '송원장', username: 'atadmin', password: 'Attend-Admin-Pass-9', withDemo: false };
const MANAGER = { username: 'atmanager', password: 'Attend-Manager-Pass-9', name: '윤실장' };
const STAFF = { username: 'atstaff', password: 'Attend-Staff-Pass-9', name: '정하늘' };

let server: IsoServer;
const url = (p: string) => `${server.baseURL}${p}`;

async function loggedIn(browser: Browser, who: { username: string; password: string }, viewport = { width: 1440, height: 900 }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport });
  const r = await ctx.request.post(url('/api/auth/login'), { data: { username: who.username, password: who.password } });
  expect(r.status(), who.username).toBe(200);
  return ctx;
}

async function axe(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test.describe.serial('출퇴근 기록', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test.beforeAll(async ({ request, isoServer }) => {
    const r = await request.post('/api/setup', { data: ADMIN });
    expect(r.status()).toBe(201);
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, MANAGER.name);
    await isoServer.addUser('staff', STAFF.username, STAFF.password, STAFF.name);
  });

  test('D-B01: 직원이 "출근하기"를 누르면 출근 시각이 보이고 "퇴근하기"로 바뀐다. 대시보드도 같은 상태, 관리 기능은 안 보인다', async ({ browser }) => {
    const ctx = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    await page.goto(url('/hr/attendance'));
    await expect(page.getByRole('heading', { level: 1, name: '출퇴근 기록' })).toBeVisible();
    await page.getByRole('button', { name: '출근하기' }).click();
    await expect(page.getByText('09:00 출근을 찍었어요')).toBeVisible();
    await expect(page.getByRole('button', { name: '퇴근하기' })).toBeVisible();
    await expect(page.getByRole('table', { name: '내 출퇴근 기록' }).getByText('근무 중')).toBeVisible();

    await expect(page.getByText('전 직원 기록')).toHaveCount(0);
    await expect(page.getByText('CSV 내려받기')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '출퇴근 설정' })).toHaveCount(0);
    expect(await axe(page)).toEqual([]);

    await page.goto(url('/'));
    await expect(page.getByRole('button', { name: /퇴근하기 \(출근 09:00\)/ })).toBeVisible();
    await ctx.close();
  });

  test('D-B01: 실장이 사유와 함께 지난달 기록을 넣으면 지난달 표에 "고침"으로 보인다. 사유를 비우면 저장되지 않는다', async ({ browser }) => {
    const ctx = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    await page.goto(url('/hr/attendance'));
    await page.getByRole('button', { name: '기록 넣기' }).click();
    const dialog = page.getByRole('dialog', { name: '출퇴근 기록 넣기' });
    await dialog.getByLabel('직원').selectOption({ label: STAFF.name });
    await dialog.getByLabel('날짜').fill('2026-10-30');
    await dialog.getByLabel('출근').fill('09:20');
    await dialog.getByLabel('퇴근').fill('18:40');
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(dialog.getByText('고치는 이유를 적어 주세요.')).toBeVisible();

    await dialog.getByLabel('고치는 이유').fill('지문기 고장으로 종이 기록 옮김');
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(page.getByText(/정하늘 님 10\/30 \(금\) 기록을 저장했어요/)).toBeVisible();

    await page.getByRole('button', { name: '지난달' }).click();
    const table = page.getByRole('table', { name: '10월 전 직원 출퇴근 기록' });
    const row = table.getByRole('row').filter({ hasText: STAFF.name });
    await expect(row).toContainText('09:20');
    await expect(row).toContainText('18:40');
    await expect(row).toContainText('9시간 20분');
    await expect(row).toContainText('고침(윤실장)');
    expect(await axe(page)).toEqual([]);
    await ctx.close();
  });

  test('D-B01: 원장은 출퇴근 설정에서 와이파이 대역을 저장한다(틀린 대역은 칸 아래 오류). 휴대폰 너비에서 가로 스크롤이 없다', async ({ browser }) => {
    const ctx = await loggedIn(browser, { username: ADMIN.username, password: ADMIN.password });
    const page = await ctx.newPage();
    await page.goto(url('/hr/attendance'));
    await page.getByRole('button', { name: '출퇴근 설정' }).click();
    const dialog = page.getByRole('dialog', { name: '출퇴근 설정' });
    const nets = dialog.getByLabel('출퇴근을 찍을 수 있는 와이파이 대역');
    await nets.fill('병원와이파이');
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(dialog.getByText(/1번째 줄\(병원와이파이\)/)).toBeVisible();
    await nets.fill('192.168.0.0/24');
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(page.getByText('출퇴근 와이파이 대역 1개를 저장했어요.')).toBeVisible();
    const saved = await ctx.request.get(url('/api/settings/attendance'));
    expect(((await saved.json()) as { data: { allowedNetworks: string[] } }).data.allowedNetworks).toEqual(['192.168.0.0/24']);
    await ctx.close();

    const phone = await loggedIn(browser, STAFF, { width: 390, height: 844 });
    const p2 = await phone.newPage();
    await p2.goto(url('/hr/attendance'));
    await expect(p2.getByRole('heading', { level: 1, name: '출퇴근 기록' })).toBeVisible();
    await expectNoHorizontalScroll(p2, '출퇴근 기록 390px');
    await phone.close();
  });
});
