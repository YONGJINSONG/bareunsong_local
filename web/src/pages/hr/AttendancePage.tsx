// 이 파일이 하는 일: "출퇴근 기록" 화면(/hr/attendance, 바른송 추가 기능 D-B01). 모든 직원이 위쪽 카드에서 출근·퇴근을 찍고 이번 달 내 기록을 본다.
// 출퇴근은 원장이 허용한 병원 와이파이 대역에서만 찍힌다. 허용하지 않은 기기면 버튼 대신 이유와 기기 주소를 보여 준다(서버가 다시 확인한다).
// 지각·조퇴는 근무표의 그날 근무와 비교해 칩으로 보여 준다. 실장 이상은 전 직원 기록·직원별 합계를 보고, 사유를 적어 기록을 넣거나 고치고, CSV로 내려받는다.
// 원장은 "출퇴근 설정"에서 와이파이 대역과 지각 유예를 정한다. 화면의 주 행동은 출근·퇴근 버튼 하나다. 대화상자는 AttendanceDialogs.tsx에 있다.
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip, Kpi, KpiRow } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { Select } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Toolbar } from '../../components/Toolbar.tsx';
import { api } from '../../lib/api.ts';
import { formatDateTime, seoulParts } from '../../lib/format.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { can } from '../../../../shared/roles.ts';
import { formatMinutes, type AttendanceMonth, type AttendanceRecord, type AttendanceSummaryRow, type AttendanceToday } from '../../../../shared/schemas/attendance.ts';
import { AttendanceEditDialog, AttendanceSettingsDialog, hhmm, messageOf } from './AttendanceDialogs.tsx';
import './attendance.css';

/** 데이터 key 앞부분(찍거나 고치면 'hr:attendance'로 모두 다시 불러온다) */
const KEY = 'hr:attendance';
const WD = ['일', '월', '화', '수', '목', '금', '토'];

/** 'YYYY-MM'에 n달 더하기 */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const t = (y ?? 0) * 12 + (m ?? 1) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** '2026-11-03' → '11/3 (화)' */
function dayLabel(date: string): string {
  const p = seoulParts(date);
  return `${p.m}/${p.d} (${WD[p.wd] ?? ''})`;
}

/** 퇴근 시각(다음 날이면 앞에 표시) */
function outLabel(r: AttendanceRecord): string {
  if (!r.clockOut) return '-';
  return `${seoulParts(r.clockOut).d !== seoulParts(r.clockIn).d ? '다음 날 ' : ''}${hhmm(r.clockOut)}`;
}

/** 상태 칩들(지각·조퇴·퇴근 누락·고침). 색과 글자를 함께 쓴다 */
export function StatusChips({ r }: { r: AttendanceRecord }) {
  const chips = [];
  if (r.lateMin > 0) chips.push(<Chip key="late" tone="warn">{`지각 ${r.lateMin}분`}</Chip>);
  if (r.earlyMin > 0) chips.push(<Chip key="early" tone="warn">{`조퇴 ${r.earlyMin}분`}</Chip>);
  if (r.missingOut) chips.push(<Chip key="miss" tone="danger">퇴근 누락</Chip>);
  if (!r.clockOut && !r.missingOut) chips.push(<Chip key="on" tone="info">근무 중</Chip>);
  if (r.edited) chips.push(<Chip key="edit" tone="ghost" title={`${r.edited.by} · ${formatDateTime(r.edited.at)} · ${r.edited.reason}`}>{`고침(${r.edited.by})`}</Chip>);
  if (chips.length === 0) chips.push(<Chip key="ok" tone="ok">정상</Chip>);
  return <span className="att-chips">{chips}</span>;
}

/** 지금 시각(30초마다 새로) */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** 위쪽 출근·퇴근 카드 */
function PunchCard() {
  const toast = useToast();
  const now = useNow();
  const st = useApi<AttendanceToday>(`${KEY}:today`, () => api.get('/api/attendance/today'));
  const [busy, setBusy] = useState(false);

  const punch = async (kind: 'in' | 'out') => {
    setBusy(true);
    try {
      const r = await api.post<AttendanceRecord>(`/api/attendance/clock-${kind}`);
      if (kind === 'in') toast.show(r.lateMin > 0 ? `${hhmm(r.clockIn)} 출근을 찍었어요. 근무 시작보다 ${r.lateMin}분 늦었어요.` : `${hhmm(r.clockIn)} 출근을 찍었어요. 좋은 하루 보내세요!`);
      else toast.show(`${hhmm(r.clockOut)} 퇴근을 찍었어요. 오늘 ${formatMinutes(r.minutes)} 일했어요. 수고하셨어요!`);
    } catch (err) {
      toast.error(messageOf(err, '찍지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
      invalidate(KEY);
    }
  };

  if (st.error && !st.data) {
    return (
      <Card padded>
        <ErrorState message={st.error.message} onRetry={st.reload} />
      </Card>
    );
  }
  if (!st.data) {
    return (
      <Card padded>
        <Skeleton rows={3} label="오늘 출퇴근 상태 불러오는 중" />
      </Card>
    );
  }
  const d = st.data;
  const p = seoulParts(now);
  const rec = d.record;
  return (
    <Card className="att-punch" padded>
      <div className="att-clock">
        <div className="when">
          <span className="date">{`${p.m}월 ${p.d}일 (${WD[p.wd] ?? ''})`}</span>
          <b className="time num" aria-live="off">{`${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`}</b>
          <span className="shift">{d.shift ? `오늘 근무: ${d.shift.label} ${d.shift.start}~${d.shift.end}` : '오늘 근무표에 근무가 없어요'}</span>
        </div>
        <dl className="att-today">
          <dt>출근</dt>
          <dd className="num">{rec ? hhmm(rec.clockIn) : '-'}</dd>
          <dt>퇴근</dt>
          <dd className="num">{rec ? outLabel(rec) : '-'}</dd>
          <dt>근무</dt>
          <dd className="num">{rec?.minutes != null ? formatMinutes(rec.minutes) : rec ? '근무 중' : '-'}</dd>
        </dl>
        <div className="act">
          {!d.device.allowed ? (
            <div className="att-blocked" role="note">
              <Icon name="wifi" size="md" />
              <span>
                이 기기(<b className="num">{d.device.ip}</b>)는 출퇴근을 찍도록 허용한 병원 와이파이가 아니에요. 병원 와이파이에 연결한 뒤 화면을 새로 고쳐 주세요.
              </span>
            </div>
          ) : d.next === 'done' ? (
            <p className="att-done">
              <Icon name="check" size="md" /> 오늘 출퇴근을 모두 찍었어요.
            </p>
          ) : (
            <Button variant="primary" icon={d.next === 'in' ? 'check' : 'logout'} loading={busy} onClick={() => void punch(d.next === 'in' ? 'in' : 'out')} className="att-btn">
              {d.next === 'in' ? '출근하기' : '퇴근하기'}
            </Button>
          )}
          {rec && (rec.lateMin > 0 || rec.earlyMin > 0) ? <StatusChips r={rec} /> : null}
          {d.device.allowed && d.device.allowedNetworks.length ? <small className="muted">병원 와이파이({d.device.ip})에서 접속 중</small> : null}
        </div>
      </div>
    </Card>
  );
}

/** 출퇴근 기록 화면 */
export default function AttendancePage() {
  const { info } = useSession();
  const me = info?.user ?? null;
  const manager = can(me?.role, 'attendance.manage');
  const isAdmin = can(me?.role, 'settings.manage');
  const toast = useToast();
  // 오늘·이번 달은 서버 시계를 따른다(불러오기 전에는 이 기기 시계)
  const todayInfo = useApi<AttendanceToday>(`${KEY}:today`, () => api.get('/api/attendance/today'));
  const deviceToday = useMemo(() => {
    const p = seoulParts(new Date());
    return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  }, []);
  const today = todayInfo.data?.date ?? deviceToday;
  const thisMonth = today.slice(0, 7);
  const [picked, setMonth] = useState<string | null>(null);
  const month = picked ?? thisMonth;
  const [who, setWho] = useState('');
  const [editing, setEditing] = useState<AttendanceRecord | 'new' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const mine = useApi<AttendanceMonth>(me ? `${KEY}:mine:${month}` : null, () => api.get(`/api/attendance?month=${month}&userId=${me?.id ?? 0}`));
  const all = useApi<AttendanceMonth>(manager ? `${KEY}:all:${month}` : null, () => api.get(`/api/attendance?month=${month}`));
  const myTotal = mine.data?.summary[0] ?? null;

  const allRows = useMemo(() => (all.data ? all.data.records.filter((r) => !who || String(r.user.id) === who) : undefined), [all.data, who]);
  const staffOptions = useMemo(() => [{ value: '', label: '전 직원' }, ...(all.data?.summary ?? []).map((s) => ({ value: String(s.userId), label: s.name }))], [all.data]);
  const [y, m] = month.split('-').map(Number);

  const dateCol: Column<AttendanceRecord> = { key: 'date', header: '날짜', render: (r) => <span className="num">{dayLabel(r.workDate)}</span>, sortValue: (r) => r.workDate };
  const shiftCol: Column<AttendanceRecord> = { key: 'shift', header: '근무', render: (r) => (r.shift ? <span className="num">{`${r.shift.label} ${r.shift.start}~${r.shift.end}`}</span> : <span className="muted">-</span>) };
  const inCol: Column<AttendanceRecord> = { key: 'in', header: '출근', align: 'right', render: (r) => <span className="num">{hhmm(r.clockIn)}</span>, sortValue: (r) => r.clockIn };
  const outCol: Column<AttendanceRecord> = { key: 'out', header: '퇴근', align: 'right', render: (r) => <span className="num">{outLabel(r)}</span>, sortValue: (r) => r.clockOut ?? '' };
  const minCol: Column<AttendanceRecord> = { key: 'min', header: '근무 시간', align: 'right', render: (r) => <span className="num">{formatMinutes(r.minutes)}</span>, sortValue: (r) => r.minutes ?? -1 };
  const stCol: Column<AttendanceRecord> = { key: 'st', header: '상태', render: (r) => <StatusChips r={r} /> };

  const myColumns = [dateCol, shiftCol, inCol, outCol, minCol, stCol];
  const allColumns: Column<AttendanceRecord>[] = [
    { key: 'name', header: '이름', render: (r) => <b>{r.user.name}</b>, sortValue: (r) => r.user.name },
    ...myColumns,
    {
      key: 'act',
      header: '고치기',
      render: (r) => (
        <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`${r.user.name} ${r.workDate} 기록 고치기`}>
          고치기
        </Button>
      ),
    },
  ];
  const sumColumns: Column<AttendanceSummaryRow>[] = [
    { key: 'name', header: '이름', render: (s) => <b>{s.name}</b>, sortValue: (s) => s.name },
    { key: 'days', header: '근무일', align: 'right', render: (s) => <span className="num">{s.days}일</span>, sortValue: (s) => s.days },
    { key: 'min', header: '근무 시간', align: 'right', render: (s) => <span className="num">{formatMinutes(s.minutes)}</span>, sortValue: (s) => s.minutes },
    { key: 'late', header: '지각', align: 'right', render: (s) => (s.lateCount ? <Chip tone="warn">{`${s.lateCount}회`}</Chip> : <span className="num muted">0회</span>), sortValue: (s) => s.lateCount },
    { key: 'early', header: '조퇴', align: 'right', render: (s) => (s.earlyCount ? <Chip tone="warn">{`${s.earlyCount}회`}</Chip> : <span className="num muted">0회</span>), sortValue: (s) => s.earlyCount },
    { key: 'miss', header: '퇴근 누락', align: 'right', render: (s) => (s.missingOutCount ? <Chip tone="danger">{`${s.missingOutCount}건`}</Chip> : <span className="num muted">0건</span>), sortValue: (s) => s.missingOutCount },
  ];

  const headerActions = (
    <>
      {manager ? (
        <a className="btn" href={`/api/attendance/export.csv?month=${month}`} download>
          CSV 내려받기
        </a>
      ) : null}
      {isAdmin ? (
        <Button icon="gear" onClick={() => setSettingsOpen(true)}>
          출퇴근 설정
        </Button>
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader
        title="출퇴근 기록"
        summary={myTotal ? `${m}월 내 근무 ${myTotal.days}일 · ${formatMinutes(myTotal.minutes)}` : `${m}월 기록`}
        actions={headerActions}
      />

      <div className="att-stack">
        <PunchCard />

        <Toolbar label="달 고르기">
          <div className="att-month">
            <Button size="sm" variant="ghost" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="지난달">
              지난달
            </Button>
            <b className="num">{`${y}년 ${m}월`}</b>
            <Button size="sm" variant="ghost" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth} aria-label="다음 달">
              다음 달
            </Button>
          </div>
        </Toolbar>

        <KpiRow label={`${m}월 내 출퇴근 요약`}>
          <Kpi label="근무일" value={mine.data ? String(myTotal?.days ?? 0) : null} unit="일" />
          <Kpi label="근무 시간" value={mine.data ? String(Math.floor((myTotal?.minutes ?? 0) / 60)) : null} unit="시간" hint={myTotal ? formatMinutes(myTotal.minutes) : undefined} />
          <Kpi label="지각" value={mine.data ? String(myTotal?.lateCount ?? 0) : null} unit="회" tone={myTotal?.lateCount ? 'warn' : undefined} />
          <Kpi label="퇴근 누락" value={mine.data ? String(myTotal?.missingOutCount ?? 0) : null} unit="건" tone={myTotal?.missingOutCount ? 'danger' : undefined} hint={myTotal?.missingOutCount ? '실장님께 고쳐 달라고 해 주세요' : undefined} />
        </KpiRow>

        <Card title="내 기록" sub={mine.data ? `${mine.data.records.length}일` : undefined}>
          <DataTable
            caption="내 출퇴근 기록"
            columns={myColumns}
            rows={mine.data?.records}
            rowKey={(r) => r.id}
            loading={mine.loading}
            error={mine.error}
            onRetry={mine.reload}
            empty={<EmptyState icon="cal" title={`${m}월 출퇴근 기록이 없어요`} description="위쪽 카드에서 출근을 찍으면 여기에 쌓여요." />}
          />
        </Card>

        {manager ? (
          <Card title="직원별 합계" sub={all.data ? `${all.data.summary.length}명` : undefined}>
            <DataTable
              caption={`${m}월 직원별 출퇴근 합계`}
              columns={sumColumns}
              rows={all.data?.summary}
              rowKey={(s) => s.userId}
              loading={all.loading}
              error={all.error}
              onRetry={all.reload}
              empty={<EmptyState icon="people" title="이 달에는 아직 기록이 없어요" description="직원이 출근을 찍으면 여기에 합계가 보여요." />}
            />
          </Card>
        ) : null}

        {manager ? (
          <Card
            title="전 직원 기록"
            sub={allRows ? `${allRows.length}건` : undefined}
            action={
              <Button size="sm" icon="plus" onClick={() => setEditing('new')}>
                기록 넣기
              </Button>
            }
          >
            <Toolbar label="전 직원 기록 도구">
              <label className="att-filter">
                <span>직원</span>
                <Select value={who} onChange={(e) => setWho(e.target.value)} options={staffOptions} aria-label="직원으로 거르기" />
              </label>
            </Toolbar>
            <DataTable
              caption={`${m}월 전 직원 출퇴근 기록`}
              columns={allColumns}
              rows={allRows}
              rowKey={(r) => r.id}
              loading={all.loading}
              error={all.error}
              onRetry={all.reload}
              empty={<EmptyState icon="inbox" title="기록이 없어요" description="퇴근을 깜빡한 날 등은 '기록 넣기'로 넣을 수 있어요." />}
            />
          </Card>
        ) : null}
      </div>

      {editing ? (
        <AttendanceEditDialog
          record={editing === 'new' ? null : editing}
          today={today}
          onClose={() => setEditing(null)}
          onSaved={(r) => {
            setEditing(null);
            invalidate(KEY);
            toast.show(`${r.user.name} 님 ${dayLabel(r.workDate)} 기록을 저장했어요. 활동 기록에 남았어요.`);
          }}
        />
      ) : null}
      {settingsOpen ? (
        <AttendanceSettingsDialog
          currentIp={todayInfo.data?.device.ip ?? null}
          onClose={() => setSettingsOpen(false)}
          onSaved={(s) => {
            setSettingsOpen(false);
            invalidate(KEY);
            toast.show(s.allowedNetworks.length ? `출퇴근 와이파이 대역 ${s.allowedNetworks.length}개를 저장했어요.` : '원내 네트워크 어디서나 찍을 수 있게 저장했어요.');
          }}
        />
      ) : null}
    </>
  );
}
