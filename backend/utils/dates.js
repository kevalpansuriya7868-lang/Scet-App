const IST = 5.5 * 3600e3;
const DAY = 864e5;

/** Same rule as the desktop app: TRUNC(today) + days + 16h (= 4 PM IST on the due day). */
function computeDue(days, now = Date.now()) {
  const ist = new Date(now + IST);
  const midnightUtc = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST;
  return new Date(midnightUtc + days * DAY + 16 * 3600e3);
}

/** Fine = whole days elapsed since due time x rate (matches TRUNC(SYSDATE - due_date) * 10). */
function overdueInfo(dueMs, rate, now = Date.now()) {
  const late = now - dueMs;
  if (late <= 0) return { overdue: false, daysLate: 0, fine: 0 };
  const daysLate = Math.floor(late / DAY);
  return { overdue: true, daysLate, fine: daysLate * rate };
}

const fmt = (d) =>
  new Date(d).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });

module.exports = { computeDue, overdueInfo, fmt };
