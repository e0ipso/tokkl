// Start, Stop, Pause and Resume as requests the menu follows to their end.
// tokkl-timerd's RequestStart, RequestStop, RequestPause and RequestResume
// return an id, and its RequestFinished signal later carries that id with
// whether the server applied the write and, if not, why. The plain methods
// only say whether a request was sent, and their failure lands in the
// shared Status and ErrorString, where a caller cannot tell it from
// anything else.
//
// The extension updates from extensions.gnome.org while the service comes
// from a package, so a new extension often talks to an older service. The
// Request methods came with InterfaceVersion 1 (hasRequestMethods() in
// timer1.js); a service below it gets the plain method, as it did before.
// Delete that path when OLDEST_SUPPORTED_INTERFACE_VERSION in timer1.js
// becomes 1. Nothing here imports from GNOME Shell, so Node runs its tests.

import { hasRequestMethods } from './timer1.js';

/**
 * @typedef {(method: string, done: (reply: any[] | null, error: any) => void) => void} Call
 *     calls a Timer1 method with no arguments; done gets its out arguments
 *     or the error
 */

export class TimerRequests {
    /**
     * @param {Call} call
     * @param {() => number} interfaceVersion the service's InterfaceVersion
     *     now, 0 for a service without it
     */
    constructor(call, interfaceVersion) {
        this._call = call;
        this._interfaceVersion = interfaceVersion;
        /** @type {Map<number, (ok: boolean, error: string) => void>} */
        this._waiting = new Map();
    }

    /**
     * Sends Start, Stop, Pause or Resume. sent says whether the service sent
     * a request, or is null when the call itself failed; finished comes
     * later, once, for a request the service follows, with whether the
     * server applied it and the service's words when it did not. A service
     * with only the plain methods never calls finished.
     *
     * @param {'Start' | 'Stop' | 'Pause' | 'Resume'} action
     * @param {{sent?: (sent: boolean | null, error: any) => void,
     *     finished?: (ok: boolean, error: string) => void}} [handlers]
     */
    send(action, handlers = {}) {
        const sent = handlers.sent ?? (() => {});
        if (!hasRequestMethods(this._interfaceVersion())) {
            this._call(action, (reply, error) => sent(error ? null : Boolean(reply[0]), error));
            return;
        }
        this._call(`Request${action}`, (reply, error) => {
            if (error) {
                sent(null, error);
                return;
            }
            const id = Number(reply[0]);
            if (id > 0 && handlers.finished) this._waiting.set(id, handlers.finished);
            sent(id > 0, null);
        });
    }

    /**
     * The service's RequestFinished signal.
     *
     * @param {number|bigint} id
     * @param {boolean} ok
     * @param {string} error
     */
    finished(id, ok, error) {
        const key = Number(id);
        const done = this._waiting.get(key);
        if (!done) return;
        this._waiting.delete(key);
        done(ok, error);
    }

    /** Another service owns the name, or none does: its requests are gone. */
    reset() {
        this._waiting.clear();
    }
}
