import { fromSqlDate } from "./client";

function dateTimePartsInTimezone(
  value: Date,
  timezone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(value);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
    hour: Number(parts.find((part) => part.type === "hour")?.value),
    minute: Number(parts.find((part) => part.type === "minute")?.value),
    second: Number(parts.find((part) => part.type === "second")?.value)
  };
}

function timeZoneOffsetMinutes(value: Date, timezone: string): number {
  const parts = dateTimePartsInTimezone(value, timezone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((localAsUtc - value.getTime()) / 60_000);
}

function parseDateKey(dateKey: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function timezoneDateKeyToUtc(dateKey: string, timezone: string): Date {
  const { year, month, day } = parseDateKey(dateKey);
  const localMidnightAsUtc = Date.UTC(year, month - 1, day);
  let utcMs = localMidnightAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offset = timeZoneOffsetMinutes(new Date(utcMs), timezone);
    const nextUtcMs = localMidnightAsUtc - offset * 60_000;
    if (nextUtcMs === utcMs) {
      break;
    }
    utcMs = nextUtcMs;
  }
  return new Date(utcMs);
}

function utcDateFromKey(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function dateKeyFromUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const value = utcDateFromKey(dateKey);
  value.setUTCDate(value.getUTCDate() + days);
  return dateKeyFromUtcDate(value);
}

export function dateKeyInTimezone(value: unknown, timezone: string): string | null {
  const iso = fromSqlDate(value);
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function calendarDayRangeInTimezone(dateKey: string, timezone: string): { start: Date; end: Date } {
  return {
    start: timezoneDateKeyToUtc(dateKey, timezone),
    end: timezoneDateKeyToUtc(addDaysToDateKey(dateKey, 1), timezone)
  };
}

export function previousCalendarDayRange(timezone: string, now = new Date()): { start: Date; end: Date } {
  const today = dateKeyInTimezone(now, timezone);
  if (!today) {
    throw new Error(`Unable to derive current date in timezone ${timezone}.`);
  }
  return calendarDayRangeInTimezone(addDaysToDateKey(today, -1), timezone);
}
