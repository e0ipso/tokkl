// A typed secret belongs to the URL, sign-in method and (for password) email it
// was typed for, so it never goes to an instance or account it was not meant for.

export function connectionIdentity(url, mode, email) {
    return JSON.stringify([url.trim(), mode, mode === 'password' ? email.trim() : '']);
}

export class TypedSecret {
    constructor() {
        this._identity = null;
    }

    edited(secret, identity) {
        this._identity = secret === '' ? null : identity;
    }

    staleFor(secret, identity) {
        return secret !== '' && this._identity !== null && this._identity !== identity;
    }
}
