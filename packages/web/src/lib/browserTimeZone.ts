/** The IANA time zone this browser runs in, such as "Europe/Madrid". */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
