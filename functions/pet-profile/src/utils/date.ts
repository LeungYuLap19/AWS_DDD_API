export function isValidDateFormat(dateString: string): boolean {
  if (!dateString || typeof dateString !== 'string') {
    return false;
  }

  const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const ddmmyyyyMatch = dateString.match(ddmmyyyy);
  if (ddmmyyyyMatch) {
    const [, day, month, year] = ddmmyyyyMatch;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return (
      date.getFullYear() === Number(year) &&
      date.getMonth() === Number(month) - 1 &&
      date.getDate() === Number(day)
    );
  }

  const iso =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):?(\d{2}))?)?$/.exec(
      dateString
    );
  if (!iso) {
    return false;
  }

  const [, year, month, day, hh, mm, ss, offsetSign, offsetHour, offsetMinute] = iso;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  const dateOk =
    date.getFullYear() === Number(year) &&
    date.getMonth() === Number(month) - 1 &&
    date.getDate() === Number(day);

  if (!dateOk) {
    return false;
  }

  if (hh !== undefined) {
    if (Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) {
      return false;
    }

    if (
      offsetSign !== undefined &&
      (Number(offsetHour) > 23 || Number(offsetMinute) > 59)
    ) {
      return false;
    }
  }

  return true;
}

export function parseFlexibleDate(dateString?: string | null): Date | null {
  if (!dateString) {
    return null;
  }

  if (dateString.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(dateString)) {
    return new Date(dateString);
  }

  const parts = dateString.split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    if (day && month && year && day.length <= 2 && month.length <= 2 && year.length === 4) {
      return new Date(Number(year), Number(month) - 1, Number(day));
    }
  }

  return new Date(dateString);
}
