import { resolvePeriod, type Period } from '@/lib/dates/ranges';
import { getSettings } from '@/services/settings.service';
import { first, type RawSearchParams } from './search-params';

/** The period a dashboard and its table are showing, from `?period=&from=&to=` and the organisation's settings. */
export async function getPeriod(sp: RawSearchParams, now = new Date()): Promise<Period> {
  const settings = await getSettings();
  return resolvePeriod(
    { period: first(sp, 'period'), from: first(sp, 'from'), to: first(sp, 'to') },
    now,
    { fyStartMonth: settings.fyStartMonth, timeZone: settings.timezone },
  );
}
