// The token or password typed in the preferences belongs to the connection
// it was typed for: the instance URL, the sign-in method and, for password
// sign-in, the email. When any of them changes afterwards, the secret is
// dropped and has to be typed again, so a secret never goes to an instance
// or account it was not meant for. Nothing here imports from GNOME, so Node
// runs its tests.

/**
 * The connection a secret is meant for, as one comparable value.
 *
 * @param {string} url the instance URL as typed
 * @param {string} mode "token" or "password"
 * @param {string} email the email as typed; ignored for token sign-in
 * @returns {string}
 */
export function connectionIdentity(url, mode, email) {
    return JSON.stringify([url.trim(), mode, mode === 'password' ? email.trim() : '']);
}

export class TypedSecret {
    constructor() {
        this._identity = null;
    }

    /**
     * The secret was edited while the form named this connection.
     *
     * @param {string} secret the secret's text after the edit
     * @param {string} identity from connectionIdentity()
     */
    edited(secret, identity) {
        this._identity = secret === '' ? null : identity;
    }

    /**
     * Whether a secret typed for another connection is still in the form,
     * after the URL, the sign-in method or the email changed.
     *
     * @param {string} secret the secret's text
     * @param {string} identity from connectionIdentity(), for the form now
     * @returns {boolean} true when the secret must be cleared
     */
    staleFor(secret, identity) {
        return secret !== '' && this._identity !== null && this._identity !== identity;
    }
}
