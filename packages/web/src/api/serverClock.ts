/** How far the server is ahead, retaken with every state. It describes the device, so signing out keeps it. */
let offsetMs = 0;

/** Null if the server time is unreadable. */
export function clockOffset(serverTime: string, receivedAt: number): number | null {
  const server = Date.parse(serverTime);
  return Number.isFinite(server) ? server - receivedAt : null;
}

export function serverNow(localNow: number, offset: number): Date {
  return new Date(localNow + offset);
}

export function setClockOffset(offset: number): void {
  offsetMs = offset;
}

export function getClockOffset(): number {
  return offsetMs;
}
