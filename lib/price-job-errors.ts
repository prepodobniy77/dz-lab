export class SweepIntervalError extends Error {
 readonly retryAfter: number;
 readonly reason?: 'active_portion';

 constructor(retryAfter = 660 * 60, reason?: 'active_portion') {
  super('Обновление уже запускалось. Дождись окончания защитного интервала.');
  this.retryAfter = Math.max(1, Math.ceil(retryAfter));
  this.reason = reason;
 }
}
export class ScheduledSweepError extends Error {}
export function sweepErrorStatus(error:unknown){return error instanceof SweepIntervalError?429:503}

// Наружу возвращаются только известные коды, без тела ответа и секретов.
export function priceSweepFailureMessage(error:unknown){
 if(error instanceof ScheduledSweepError)return error.message;
 const message=error instanceof Error?error.message:'';
 const match=/^(RouterAI|API ИИ-поиска): HTTP ([1-5][0-9]{2})$/.exec(message);
 if(match)return `Обновление остановлено: ${match[1]} вернул HTTP ${match[2]}. Неподтверждённые цены и даты не изменены.`;
 if(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name))return 'Истекло время ожидания API. Неподтверждённые цены и даты не изменены.';
 return 'Проверка завершилась частично. Ошибка API или источника. Неподтверждённые цены и даты не изменены.';
}
