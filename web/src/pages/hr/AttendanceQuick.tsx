// 이 파일이 하는 일: 대시보드 위쪽 버튼 줄에 붙는 "출근하기·퇴근하기" 빠른 버튼(바른송 추가 기능 D-B01). 누르면 바로 찍고 결과를 알림으로 보여 준다.
// 오늘 다 찍었거나, 이 기기가 허용한 병원 와이파이가 아니거나, 상태를 못 불러오면 출퇴근 기록 화면(/hr/attendance)으로 가는 버튼이 된다.
// 대시보드의 주 행동(채워진 버튼)은 따로 있으므로 이 버튼은 기본 모양이다. 상태 key는 출퇴근 화면과 같은 'hr:attendance:today'를 함께 쓴다.
import { useState } from 'react';
import { Button } from '../../components/Button.tsx';
import { useToast } from '../../components/Toast.tsx';
import { api } from '../../lib/api.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { formatMinutes, type AttendanceRecord, type AttendanceToday } from '../../../../shared/schemas/attendance.ts';
import { hhmm, messageOf } from './AttendanceDialogs.tsx';

/** 대시보드용 출퇴근 빠른 버튼 */
export function AttendanceQuickButton() {
  const toast = useToast();
  const st = useApi<AttendanceToday>('hr:attendance:today', () => api.get('/api/attendance/today'));
  const [busy, setBusy] = useState(false);
  const d = st.data;

  if (!d || !d.device.allowed || d.next === 'done') {
    const done = d?.next === 'done' && d.record?.clockOut;
    return (
      <Button to="/hr/attendance" icon="cal">
        {done ? `퇴근 ${hhmm(d.record?.clockOut ?? null)}` : '출퇴근 기록'}
      </Button>
    );
  }

  const kind = d.next === 'in' ? 'in' : 'out';
  const punch = async () => {
    setBusy(true);
    try {
      const r = await api.post<AttendanceRecord>(`/api/attendance/clock-${kind}`);
      toast.show(kind === 'in' ? `${hhmm(r.clockIn)} 출근을 찍었어요.${r.lateMin > 0 ? ` 근무 시작보다 ${r.lateMin}분 늦었어요.` : ''}` : `${hhmm(r.clockOut)} 퇴근을 찍었어요. 오늘 ${formatMinutes(r.minutes)} 일했어요.`);
    } catch (err) {
      toast.error(messageOf(err, '찍지 못했어요. 출퇴근 기록 화면에서 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
      invalidate('hr:attendance');
    }
  };

  return (
    <Button icon={kind === 'in' ? 'check' : 'logout'} loading={busy} onClick={() => void punch()}>
      {kind === 'in' ? '출근하기' : `퇴근하기${d.record ? ` (출근 ${hhmm(d.record.clockIn)})` : ''}`}
    </Button>
  );
}
