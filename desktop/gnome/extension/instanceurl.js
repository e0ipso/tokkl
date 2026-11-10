// Copy of ConnectionSetup::isInsecure() (see core/autotests/insecureurls.json):
// asking a stopped service would start it through D-Bus activation.

const URL_PATTERN = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)$/;

function hostOf(authority) {
    const match = /^(?:\[([0-9A-Fa-f:.]+)\]|([^:[\]]*))(?::(\d*))?$/.exec(authority);
    if (!match) return null;
    if (match[3] && Number(match[3]) > 65535) return null;
    const host = (match[1] ?? match[2]).toLowerCase();
    if (match[1] !== undefined && ipv6Groups(host) === null) return null;
    return host === '' ? null : host;
}

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

// An unusable address gets no warning: the service refuses it on Connect.
export function isInsecureUrl(text) {
    const match = URL_PATTERN.exec(text.trim());
    if (!match || match[1].toLowerCase() !== 'http' || match[2].includes('@')) return false;
    const host = hostOf(match[2]);
    return host !== null && host !== 'localhost' && !isLoopback(host);
}
