// Whether an instance address sends the secret unencrypted, by the rule of
// the core's ConnectionSetup::isInsecure(), which the KDE and macOS settings
// use: a usable http:// address whose host is neither localhost nor a
// loopback address. desktop/core/autotests/insecureurls.json holds the cases
// both follow. Nothing here imports from GNOME, so Node runs its tests.

// scheme://authority/path, with no query or fragment.
const URL_PATTERN = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)$/;

/**
 * The host of an authority without user info, lowercased, or null when it
 * has none or its port is not one.
 *
 * @param {string} authority
 * @returns {string|null}
 */
function hostOf(authority) {
    const match = /^(?:\[([0-9A-Fa-f:.]+)\]|([^:[\]]*))(?::(\d*))?$/.exec(authority);
    if (!match) return null;
    if (match[3] && Number(match[3]) > 65535) return null;
    const host = (match[1] ?? match[2]).toLowerCase();
    if (match[1] !== undefined && ipv6Groups(host) === null) return null;
    return host === '' ? null : host;
}

/**
 * The eight groups of an IPv6 address, or null when it is not one.
 *
 * @param {string} host
 * @returns {number[]|null}
 */
function ipv6Groups(host) {
    const halves = host.split('::');
    if (halves.length > 2) return null;
    const groups = halves.map(half => (half === '' ? [] : half.split(':')));
    const count = groups.reduce((sum, half) => sum + half.length, 0);
    if (halves.length === 1 ? count !== 8 : count > 7) return null;
    const filled = halves.length === 1 ? groups[0] : [...groups[0], ...Array(8 - count).fill('0'), ...groups[1]];
    if (!filled.every(group => /^[0-9a-f]{1,4}$/.test(group))) return null;
    return filled.map(group => parseInt(group, 16));
}

function isLoopback(host) {
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (ipv4) return ipv4.slice(1).every(part => Number(part) <= 255) && ipv4[1] === '127';
    const groups = ipv6Groups(host);
    return groups !== null && groups.slice(0, 7).every(group => group === 0) && groups[7] === 1;
}

/**
 * Whether the settings should warn that the address uses plain http. An
 * address that is not usable gets no warning: the service refuses it when
 * Connect sends it.
 *
 * @param {string} text the instance URL as typed
 * @returns {boolean}
 */
export function isInsecureUrl(text) {
    const match = URL_PATTERN.exec(text.trim());
    if (!match || match[1].toLowerCase() !== 'http' || match[2].includes('@')) return false;
    const host = hostOf(match[2]);
    return host !== null && host !== 'localhost' && !isLoopback(host);
}
