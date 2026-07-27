const relativeFormatter = new Intl.RelativeTimeFormat("ar", { numeric: "always" });

export const dateTimeFormatter = new Intl.DateTimeFormat("ar-EG", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** "٣ س ٢٥ د" — work duration from seconds. */
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0 && minutes === 0) return "أقل من دقيقة";
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours.toLocaleString("ar-EG")} س`);
  if (minutes > 0) parts.push(`${minutes.toLocaleString("ar-EG")} د`);
  return parts.join(" ");
}

/** "بعد ٥ ساعات" / "قبل ٣ أيام" — relative to now. */
export function formatRelative(iso: string): string {
  const diffSeconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diffSeconds);
  if (abs < 3600) return relativeFormatter.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86400) return relativeFormatter.format(Math.round(diffSeconds / 3600), "hour");
  return relativeFormatter.format(Math.round(diffSeconds / 86400), "day");
}
