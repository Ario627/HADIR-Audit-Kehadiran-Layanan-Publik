import { randomUUID } from 'node:crypto';
import { env } from '../common/config/env';
import { signInvite } from '../common/auth/invite-token';

const TTL_SECONDS = 900;

function required(name: string): string {
  const value = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`));
  if (value === undefined) {
    throw new Error(`Argumen --${name}=... wajib diisi.`);
  }
  return value.slice(name.length + 3);
}

function main(): void {
  const payload = {
    sub: required('user'),
    inst: required('institution'),
    role: required('role') as 'viewer' | 'responder' | 'admin',
    jti: randomUUID().replaceAll('-', ''),
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  };
  process.stdout.write(`${signInvite(payload, env.SESSION_SECRET)}\n`);
}

main();