// 이 파일이 하는 일: 대시보드(/, FR-008). GET /api/dashboard 한 번으로 요약 숫자 6개와 카드 10개(DESIGN §4 순서)를 채운다.
// 빠른 행동: 맨 앞 "출근하기·퇴근하기"(바른송 추가, hr/AttendanceQuick.tsx)는 바로 찍는다. "출고 기록"은 이 화면에서 출고 빠른 입력 대화상자를 열어 버튼 → 품목 → 저장 세 번에 끝난다(NFR-009). 공지 쓰기·AI 문서 작성은 해당 화면으로 간다.
// 역할별 표시(FR-008 AC4): 승인 대기·발주 진행·이번 달 지출은 원장·실장만 보이고, 직원 칸에는 "내 휴가 신청"이 대신 보인다.
// 카드 본문은 dashboardCards.tsx, 글자 계산은 dashboardLib.ts, 모양은 dashboard.css에 있다.
import { useState } from 'react';
import { can, ROLE_LABELS } from '../../../shared/roles.ts';
import type { DashboardData } from '../../../shared/schemas/dashboard.ts';
import { Button } from '../components/Button.tsx';
import { CardGrid, PageHeader } from '../components/Card.tsx';
import { Kpi, KpiRow } from '../components/Chip.tsx';
import { api } from '../lib/api.ts';
import { formatDateLong, greeting } from '../lib/format.ts';
import { useSession } from '../lib/session.tsx';
import { useApi } from '../lib/useApi.ts';
import { QuickOutDialog } from './inventory/QuickOutDialog.tsx';
import { AttendanceQuickButton } from './hr/AttendanceQuick.tsx';
import { AiQuickCard, DueCard, ExpenseCard, MovesCard, NoticeCard, OrdersCard, RosterSlotCard, StockCard, TodoCard, WeekCard } from './dashboardCards.tsx';
import { dueHint, stockHint, todaySummary, won } from './dashboardLib.ts';
import './dashboard.css';

/** 대시보드 데이터 key(저장 뒤 invalidate('dashboard')로 다시 불러온다) */
export const DASHBOARD_KEY = 'dashboard';

/** 대시보드 */
export default function DashboardPage() {
  const { info } = useSession();
  const user = info?.user;
  const state = useApi<DashboardData>(user ? DASHBOARD_KEY : null, () => api.get<DashboardData>('/api/dashboard'));
  const [quickOut, setQuickOut] = useState(false);
  if (!user) return null;
  const role = user.role;
  const d = state.data;
  const manager = can(role, 'leave.approve');
  const loadingHint = state.error && !d ? '불러오지 못했어요' : '불러오는 중';

  // 날짜·인사말은 서버 시계(d.now·d.today)를 따른다. 불러오기 전에는 날짜 없이 인사만 한다
  const summary = [d ? formatDateLong(d.today.date) : '', d ? todaySummary(d.today) : '', ROLE_LABELS[role]].filter(Boolean).join(' · ');
  const month = d ? Number(d.ai.month.slice(5)) : null;
  const k = d?.kpis;

  return (
    <>
      <PageHeader
        title={`${d ? greeting(d.now) : '안녕하세요'}, ${user.name}님`}
        summary={summary}
        actions={
          <>
            <AttendanceQuickButton />
            <Button icon="box" onClick={() => setQuickOut(true)}>
              출고 기록
            </Button>
            {can(role, 'notices.write') ? (
              <Button to="/desk/board" icon="plus">
                공지 쓰기
              </Button>
            ) : (
              <Button to="/desk/board?tab=handover" icon="plus">
                인수인계 쓰기
              </Button>
            )}
            <Button to="/docs/writer" icon="spark" variant="primary">
              AI 문서 작성
            </Button>
          </>
        }
      />

      <KpiRow>
        <Kpi
          label="오늘 근무"
          value={k ? k.working : null}
          unit="명"
          hint={d ? (d.today.onLeave.length ? `휴가 ${d.today.onLeave.length}명` : d.today.rosterReady ? '휴가 없음' : '근무표를 만들면 보여요') : loadingHint}
          to="/hr/roster"
        />
        <Kpi
          label="오픈 체크리스트"
          value={k ? (k.checklistOpen.total ? k.checklistOpen.done : null) : null}
          unit={k ? `/ ${k.checklistOpen.total}` : undefined}
          hint={k ? (k.checklistOpen.total ? `남은 ${k.checklistOpen.total - k.checklistOpen.done}건` : '항목을 만들면 보여요') : loadingHint}
          tone={k && k.checklistOpen.total && k.checklistOpen.done === k.checklistOpen.total ? 'ok' : undefined}
          to="/desk/checklist"
        />
        <Kpi
          label="재고 경고"
          value={k ? k.stock.total : null}
          unit="건"
          hint={k ? stockHint(k.stock) : loadingHint}
          tone={k ? (k.stock.low + k.stock.expired > 0 ? 'danger' : k.stock.total > 0 ? 'warn' : undefined) : undefined}
          to="/inventory"
        />
        <Kpi
          label="30일 내 점검·의무"
          value={k ? k.due.total : null}
          unit="건"
          hint={k ? dueHint(k.due) : loadingHint}
          tone={k ? (k.due.overdue + k.due.today + k.due.sterilizerFail > 0 ? 'danger' : k.due.total > 0 ? 'warn' : undefined) : undefined}
          to="/facility/legal?view=due"
        />
        {manager ? (
          <Kpi label="승인 대기" value={k ? k.approvals : null} unit="건" hint={k ? (k.approvals ? '연차·휴가 신청' : '기다리는 신청 없음') : loadingHint} to="/hr/leave" />
        ) : (
          <Kpi
            label="내 휴가 신청"
            value={k ? k.myPendingLeave : null}
            unit="건"
            hint={k ? (k.myPendingLeave ? '승인을 기다리는 중' : '기다리는 신청 없음') : loadingHint}
            to="/hr/leave"
          />
        )}
        <Kpi
          label={month ? `${month}월 AI 사용` : '이번 달 AI 사용'}
          value={d ? d.ai.pct : null}
          unit="%"
          hint={
            d
              ? d.ai.monthKrw !== null && d.ai.budgetKrw !== null
                ? `${won(d.ai.monthKrw)} / ${won(d.ai.budgetKrw)}`
                : d.ai.demo
                  ? '데모 모드(비용 없음)'
                  : '예산 대비'
              : loadingHint
          }
          tone={d && d.ai.pct >= 100 ? 'danger' : d && d.ai.pct >= 80 ? 'warn' : undefined}
          to={can(role, 'ai.usage') ? '/admin/ai-usage' : undefined}
        />
      </KpiRow>

      <CardGrid label="오늘 현황">
        <TodoCard state={state} role={role} />
        <StockCard state={state} role={role} />
        <DueCard state={state} role={role} />
        <RosterSlotCard state={state} role={role} />
        <NoticeCard state={state} role={role} />
        <AiQuickCard state={state} role={role} />
        {can(role, 'orders.manage') ? <OrdersCard state={state} role={role} /> : null}
        <WeekCard state={state} role={role} />
        <MovesCard state={state} role={role} />
        {can(role, 'finance.monthly') ? <ExpenseCard state={state} role={role} /> : null}
      </CardGrid>

      <QuickOutDialog open={quickOut} onClose={() => setQuickOut(false)} />
    </>
  );
}
