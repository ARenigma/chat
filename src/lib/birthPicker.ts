/**
 * The platform pickers behind the birth-details card, through
 * `BirthPickerModule.kt` (framework DatePickerDialog and TimePickerDialog in a
 * DialogFragment; the file says why not MaterialDatePicker).
 * https://developer.android.com/develop/ui/views/components/pickers
 *
 * Every function answers null when the picker was dismissed or the module is
 * absent (jest, a build without it), so a caller only ever handles "picked" or
 * "not picked".
 */
import { NativeModules } from 'react-native';
import { BIRTH_YEAR_MIN, type BirthDate, type BirthTime } from './birthDetails';

interface BirthPickerNative {
  pickDate(
    year: number,
    month: number,
    day: number,
    minMillis: number,
    maxMillis: number,
  ): Promise<BirthDate | null>;
  pickTime(hour: number, minute: number): Promise<BirthTime | null>;
}

const native = NativeModules.BirthPicker as BirthPickerNative | undefined;

export function birthPickerAvailable(): boolean {
  return native !== undefined;
}

/**
 * Where the date picker opens when nothing is picked yet: 1 Jan, 25 years ago,
 * which puts a typical member a few year-taps away rather than scrolling back
 * from today.
 */
export function birthDateStart(today: Date = new Date()): BirthDate {
  return { year: today.getFullYear() - 25, month: 1, day: 1 };
}

export async function pickBirthDate(
  initial: BirthDate | null,
  today: Date = new Date(),
): Promise<BirthDate | null> {
  if (native === undefined) {
    return null;
  }
  const from = initial ?? birthDateStart(today);
  const min = new Date(BIRTH_YEAR_MIN, 0, 1).getTime();
  try {
    return await native.pickDate(
      from.year,
      from.month,
      from.day,
      min,
      today.getTime(),
    );
  } catch {
    return null;
  }
}

export async function pickBirthTime(
  initial: BirthTime | null,
): Promise<BirthTime | null> {
  if (native === undefined) {
    return null;
  }
  const from = initial ?? { hour: 12, minute: 0 };
  try {
    return await native.pickTime(from.hour, from.minute);
  } catch {
    return null;
  }
}
