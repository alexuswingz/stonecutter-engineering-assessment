/** Display formatting shared by the server-side narrative and the React client. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDay(date: string, withYear = false): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}${withYear ? ` ${year}` : ''}`;
}
export function formatRange(start: string, end: string): string {
  return `${formatDay(start)} – ${formatDay(end, true)}`;
}
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${time} UTC`;
}
export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? 'Unknown' : value.toLocaleString('en-US');
}
export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Not comparable';
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)}%`;
}
export function formatMoney(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
