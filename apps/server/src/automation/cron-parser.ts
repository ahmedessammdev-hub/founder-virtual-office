import type { CronPreset } from "@virtual-office/shared";

export const CRON_PRESETS: CronPreset[] = [
  {
    id: "every-15m",
    label: "Every 15 Minutes",
    labelAr: "كل 15 دقيقة",
    expression: "*/15 * * * *",
  },
  {
    id: "hourly",
    label: "Hourly Digest",
    labelAr: "تقرير كل ساعة",
    expression: "0 * * * *",
  },
  {
    id: "daily-9am",
    label: "Daily Standup (09:00)",
    labelAr: "ملخص يومي (9 صباحاً)",
    expression: "0 9 * * *",
  },
  {
    id: "weekday-morning",
    label: "Weekdays 09:30 (Mon–Fri)",
    labelAr: "أيام العمل 9:30 صباحاً",
    expression: "30 9 * * 1-5",
  },
];

export interface ParsedCronSchedule {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

function parseField(
  raw: string,
  min: number,
  max: number,
  fieldName: string,
  mapValue?: (val: number) => number,
): Set<number> {
  const result = new Set<number>();
  const parts = raw.split(",");
  if (parts.length === 0) {
    throw new Error(`Invalid cron field "${fieldName}": empty expression.`);
  }

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      throw new Error(`Invalid cron field "${fieldName}": empty segment.`);
    }

    const [rangePart, stepPart, ...extra] = trimmed.split("/");
    if (extra.length > 0) {
      throw new Error(`Invalid cron syntax in "${fieldName}": "${trimmed}".`);
    }

    const step = stepPart !== undefined ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`Invalid cron step in "${fieldName}": "${trimmed}".`);
    }

    let start: number;
    let end: number;

    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart!.includes("-")) {
      const [sRaw, eRaw, ...rest] = rangePart!.split("-");
      if (rest.length > 0) {
        throw new Error(`Invalid cron range in "${fieldName}": "${trimmed}".`);
      }
      start = Number(sRaw);
      end = Number(eRaw);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
        throw new Error(`Invalid cron range bounds in "${fieldName}": "${trimmed}".`);
      }
    } else {
      const single = Number(rangePart);
      if (!Number.isInteger(single)) {
        throw new Error(`Invalid cron number in "${fieldName}": "${trimmed}".`);
      }
      start = single;
      end = stepPart !== undefined ? max : single;
    }

    if (start < min || end > max) {
      throw new Error(
        `Cron value out of range in "${fieldName}" (${min}..${max}): "${trimmed}".`,
      );
    }

    for (let v = start; v <= end; v += step) {
      const normalized = mapValue ? mapValue(v) : v;
      result.add(normalized);
    }
  }

  return result;
}

export function validateCronExpression(expr: string): ParsedCronSchedule {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `Invalid cron expression "${expr}": expected exact 5 fields (minute hour day month weekday).`,
    );
  }

  return {
    minutes: parseField(fields[0]!, 0, 59, "minute"),
    hours: parseField(fields[1]!, 0, 23, "hour"),
    daysOfMonth: parseField(fields[2]!, 1, 31, "dayOfMonth"),
    months: parseField(fields[3]!, 1, 12, "month"),
    daysOfWeek: parseField(fields[4]!, 0, 7, "dayOfWeek", (v) => (v === 7 ? 0 : v)),
  };
}

export function matchesCron(expr: string, date: Date): boolean {
  const parsed = validateCronExpression(expr);
  return (
    parsed.minutes.has(date.getMinutes()) &&
    parsed.hours.has(date.getHours()) &&
    parsed.daysOfMonth.has(date.getDate()) &&
    parsed.months.has(date.getMonth() + 1) &&
    parsed.daysOfWeek.has(date.getDay())
  );
}

/**
 * Computes the next matching minute within 366 days after `fromDate`.
 */
export function computeNextRunAt(expr: string, fromDate = new Date()): string | null {
  const parsed = validateCronExpression(expr);
  const cursor = new Date(fromDate.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const maxMinutes = 366 * 24 * 60;
  for (let i = 0; i < maxMinutes; i += 1) {
    if (
      parsed.months.has(cursor.getMonth() + 1) &&
      parsed.daysOfMonth.has(cursor.getDate()) &&
      parsed.daysOfWeek.has(cursor.getDay()) &&
      parsed.hours.has(cursor.getHours()) &&
      parsed.minutes.has(cursor.getMinutes())
    ) {
      return cursor.toISOString();
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}
