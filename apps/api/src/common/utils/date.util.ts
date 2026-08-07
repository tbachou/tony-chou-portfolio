export function utcDateOnly(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function utcDaysAgo(days: number, from: Date = new Date()): Date {
  const date = utcDateOnly(from);
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}
