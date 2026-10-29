import { transactionContextFor } from './transaction-context';
import type { RequestContext } from './request-context';

const DEVICE_HASH = 'a'.repeat(64);

function contextWith(actor: RequestContext['actor']): RequestContext {
  return { requestId: 'req-12345678', device: null, actor };
}

describe('transactionContextFor', () => {
  it('carries the request id even without an actor', () => {
    expect(transactionContextFor(contextWith(null))).toEqual({ requestId: 'req-12345678' });
  });

  it('scopes a citizen to its device hash', () => {
    const result = transactionContextFor(contextWith({ kind: 'citizen', deviceHash: DEVICE_HASH }));

    expect(result).toEqual({ requestId: 'req-12345678', deviceHash: DEVICE_HASH });
  });

  it('scopes a partner to its user and institution', () => {
    const result = transactionContextFor(
      contextWith({
        kind: 'partner',
        userId: '0192f0c4-0000-7000-8000-0000000000f2',
        institutionId: '0192f0c4-0000-7000-8000-0000000000f3',
        role: 'responder',
      }),
    );

    expect(result).toEqual({
      requestId: 'req-12345678',
      userId: '0192f0c4-0000-7000-8000-0000000000f2',
      institutionId: '0192f0c4-0000-7000-8000-0000000000f3',
    });
  });

  it('never puts a partner user id into the device slot', () => {
    const result = transactionContextFor(
      contextWith({
        kind: 'partner',
        userId: '0192f0c4-0000-7000-8000-0000000000f2',
        institutionId: '0192f0c4-0000-7000-8000-0000000000f3',
        role: 'admin',
      }),
    );

    expect(result.deviceHash).toBeUndefined();
  });

  it('never puts a device hash into the partner slots', () => {
    const result = transactionContextFor(contextWith({ kind: 'citizen', deviceHash: DEVICE_HASH }));

    expect(result.userId).toBeUndefined();
    expect(result.institutionId).toBeUndefined();
  });
});
