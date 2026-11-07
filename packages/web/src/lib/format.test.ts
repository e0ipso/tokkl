import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, parseDateKey, zonedParts } from '@tokkl/common/time';
import { dayLabel, formatDateTime, formatTime, shortDate, weekdayName } from './format.ts';

// The helpers moved from English tables to Intl in the interface locale. Each is checked against
// the table version it replaced, over every day of several years and every minute of a day in
// several time zones, so the output is the same byte for byte.

const LEGACY_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LEGACY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function legacyWeekday(key: string): string {
  const parsed = parseDateKey(key)!;
  return LEGACY_WEEKDAYS[new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay()]!;
}

function legacyShortDate(key: string): string {
  const parsed = parseDateKey(key)!;
  return `${parsed.day} ${LEGACY_MONTHS[parsed.month - 1]}`;
}

function legacyDayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return 'Today';
  if (key === addDays(todayKey, -1)) return 'Yesterday';
  const parsed = parseDateKey(key)!;
  const sameYear = todayKey.startsWith(String(parsed.year));
  return `${legacyWeekday(key)}, ${legacyShortDate(key)}${sameYear ? '' : ` ${parsed.year}`}`;
}

function legacyTime(date: Date, timeZone: string, twelveHour: boolean): string {
  const p = zonedParts(date, timeZone);
  const minute = String(p.minute).padStart(2, '0');
  if (!twelveHour) return `${String(p.hour).padStart(2, '0')}:${minute}`;
  const hour = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${hour}:${minute} ${p.hour < 12 ? 'AM' : 'PM'}`;
}

const ZONES = ['UTC', 'Europe/Madrid', 'America/New_York', 'Asia/Kolkata', 'Pacific/Chatham', 'Pacific/Kiritimati'];

test('weekday and short date names match the English tables for every day of 2023 to 2028', () => {
  for (let key = '2023-01-01'; key < '2029-01-01'; key = addDays(key, 1)) {
    assert.equal(weekdayName(key), legacyWeekday(key), key);
    assert.equal(shortDate(key), legacyShortDate(key), key);
  }
});

test('day labels say Today and Yesterday, then the weekday and date, with the year when it differs', () => {
  assert.equal(dayLabel('2026-06-17', '2026-06-17'), 'Today');
  assert.equal(dayLabel('2026-06-16', '2026-06-17'), 'Yesterday');
  assert.equal(dayLabel('2026-06-15', '2026-06-17'), 'Mon, 15 Jun');
  assert.equal(dayLabel('2025-12-31', '2026-01-01'), 'Yesterday');
  assert.equal(dayLabel('2025-12-30', '2026-01-01'), 'Tue, 30 Dec 2025');
  assert.equal(dayLabel('2026-09-01', '2026-06-17'), 'Tue, 1 Sep');
  const todayKey = '2026-03-01';
  for (let key = '2025-01-01'; key < '2027-01-01'; key = addDays(key, 1)) {
    assert.equal(dayLabel(key, todayKey), legacyDayLabel(key, todayKey), key);
  }
});

test('clock times match in 24- and 12-hour form for every minute of a day in several time zones', () => {
  const start = Date.UTC(2026, 2, 29, 0, 0);
  for (const timeZone of ZONES) {
    for (const twelveHour of [false, true]) {
      for (let minute = 0; minute < 24 * 60; minute += 1) {
        const date = new Date(start + minute * 60_000);
        assert.equal(formatTime(date, { timeZone, twelveHour }), legacyTime(date, timeZone, twelveHour));
      }
    }
  }
  assert.equal(formatTime('2026-06-17T07:05:00Z', { timeZone: 'Europe/Madrid', twelveHour: false }), '09:05');
  assert.equal(formatTime('2026-06-17T07:05:00Z', { timeZone: 'Europe/Madrid', twelveHour: true }), '9:05 AM');
  assert.equal(formatTime('2026-06-17T22:00:00Z', { timeZone: 'Europe/Madrid', twelveHour: true }), '12:00 AM');
  assert.equal(formatTime('2026-06-17T10:30:00Z', { timeZone: 'Europe/Madrid', twelveHour: true }), '12:30 PM');
});

test('a date and time joins the account date format and the clock time with a space', () => {
  const settings = { timeZone: 'America/New_York', dateFormat: 'DD/MM/YYYY', twelveHour: true };
  assert.equal(formatDateTime('2026-03-10T13:30:00Z', settings), '10/03/2026 9:30 AM');
});
