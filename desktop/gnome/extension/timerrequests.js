// The Request methods return an id that RequestFinished later carries with the
// outcome. A plain method's failure lands in the shared Status and ErrorString.

export class TimerRequests {
    constructor(call) {
        this._call = call;
        this._waiting = new Map();
    }

    // finished fires once, later, only for a request the service follows.
    send(action, handlers = {}) {
        const sent = handlers.sent ?? (() => {});
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

    finished(id, ok, error) {
        const key = Number(id);
        const done = this._waiting.get(key);
        if (!done) return;
        this._waiting.delete(key);
        done(ok, error);
    }

    reset() {
        this._waiting.clear();
    }
}
