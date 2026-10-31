import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const exec = promisify(execFile);
/** Generated private keys stay inside the fixture's owned ephemeral directory. */
export async function tlsCertificates(parent: string, identity: 'dns' | 'ip' = 'dns') {
  const dir = join(parent, 'tls'); mkdirSync(dir, { mode: 0o700 });
  const openssl = async (args: string[]) => {
    try { await exec('openssl', args, { cwd: dir }); }
    catch { throw new Error('Disposable TLS certificate generation failed'); }
  };
  await openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=Disposable Test CA', '-keyout', 'ca.key', '-out', 'ca.pem']);
  const name = identity === 'ip' ? '127.0.0.1' : 'localhost';
  await openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${name}`, '-keyout', 'server.key', '-out', 'server.csr']);
  writeFileSync(join(dir, 'server.ext'), `subjectAltName=${identity === 'ip' ? 'IP:127.0.0.1' : 'DNS:localhost'}\nextendedKeyUsage=serverAuth\n`);
  await openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '2', '-extfile', 'server.ext', '-out', 'server.pem']);
  await openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=Unrelated Test CA', '-keyout', 'untrusted.key', '-out', 'untrusted.pem']);
  for (const key of ['ca.key', 'server.key', 'untrusted.key']) chmodSync(join(dir, key), 0o600);
  return { dir, caFile: join(dir, 'ca.pem'), untrustedCaFile: join(dir, 'untrusted.pem') };
}
