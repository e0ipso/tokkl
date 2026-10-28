/**
 * The server's clock against this device's. The offset is how far the server is ahead, taken
 * when a state arrives and again with every state, so a device clock that drifts or jumps is
 * corrected by the next state. It describes the device, not the account, so signing out keeps it.
 */
let offsetMs = 0;

/** The server time of a state minus the local time (ms since the epoch) it arrived at, or null if the server time is unreadable. */
export function clockOffset(serverTime: string, receivedAt: number): number | null {
  const server = Date.parse(serverTime);
  return Number.isFinite(server) ? server - receivedAt : null;
}

/** The server's time when this device's clock reads `localNow`. */
export function serverNow(localNow: number, offset: number): Date {
  return new Date(localNow + offset);
}

export function setClockOffset(offset: number): void {
  offsetMs = offset;
}

export function getClockOffset(): number {
  return offsetMs;
}
