export function isWithinRestaurantHours(
  opensAt: string | null,
  closesAt: string | null,
  now = new Date(),
) {
  if (!opensAt || !closesAt) return true;
  const parse = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  };
  const open = parse(opensAt);
  const close = parse(closesAt);
  if (!Number.isFinite(open) || !Number.isFinite(close) || open === close)
    return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Bahia",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const current =
    Number(parts.find((part) => part.type === "hour")?.value) * 60 +
    Number(parts.find((part) => part.type === "minute")?.value);
  return open < close
    ? current >= open && current < close
    : current >= open || current < close;
}
