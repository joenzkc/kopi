import type { ActualSchedule, ActualTransaction } from '../../shared/types';

export function scheduleImportId(scheduleId: string, date: string): string {
  return 'kopi:bill:' + encodeURIComponent(scheduleId) + ':' + date;
}

export function postedScheduleId(tx: ActualTransaction, schedules: ActualSchedule[]): string | undefined {
  const ownPost = schedules.find((schedule) => tx.imported_id === scheduleImportId(schedule.id, tx.date));
  if (tx.schedule || ownPost) return tx.schedule || ownPost?.id;
  const legacyPosts = schedules.filter((schedule) =>
    schedule.account === tx.account &&
    (!schedule.payee || schedule.payee === tx.payee) &&
    tx.notes === 'Posted from schedule: ' + (schedule.name || schedule.id),
  );
  return legacyPosts.length === 1 ? legacyPosts[0].id : undefined;
}
