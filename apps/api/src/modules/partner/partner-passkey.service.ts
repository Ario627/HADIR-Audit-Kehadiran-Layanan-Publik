import { Injectable } from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import { AuditService } from '../../common/audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { WEBAUTHN } from '../../common/config/auth-config';
import { b64urlToBuffer, bufferToB64url } from '../../common/auth/webauthn-codec';
import { PartnerCredentialRepository } from '../../db/repositories/partner-credential.repository';

export interface PasskeyChallenge {
  challengeId: string;
  options: PublicKeyCredentialCreationOptionsJSON | PublicKeyCredentialRequestOptionsJSON;
}

export interface PasskeyAuditContext {
  requestId: string;
  ipHash: string | null;
}

@Injectable()
export class PartnerPasskeyService {
  constructor(
    private readonly repository: PartnerCredentialRepository,
    private readonly audit: AuditService,
  ) {}

  async beginRegistration(
    userId: string,
    displayName: string,
  ): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
    const existing = await this.repository.listWebAuthnByUserId(userId);
    const options = await generateRegistrationOptions({
      rpName: WEBAUTHN.rpName,
      rpID: WEBAUTHN.rpId,
      userID: Buffer.from(userId, 'utf8'),
      userName: displayName,
      attestationType: 'none',
      excludeCredentials: existing.map((credential) => ({
        id: bufferToB64url(credential.credentialId),
        transports: credential.transports as never,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
    });

    const challengeId = await this.repository.insertWebAuthnChallenge(
      userId,
      options.challenge,
      'registration',
      new Date(Date.now() + WEBAUTHN.challengeTtlMs),
    );
    return { challengeId, options };
  }

  async finishRegistration(
    userId: string,
    challengeId: string,
    response: RegistrationResponseJSON,
    context: PasskeyAuditContext,
  ): Promise<void> {
    const challenge = await this.repository.consumeWebAuthnChallenge(challengeId);
    if (challenge === null || challenge.userId !== userId) {
      throw new AppError('UNAUTHENTICATED', { detail: 'Tantangan passkey tidak valid.' });
    }

    const verified = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: WEBAUTHN.origin,
      expectedRPID: WEBAUTHN.rpId,
      requireUserVerification: true,
    });
    if (!verified.verified) {
      throw new AppError('UNAUTHENTICATED', { detail: 'Pendaftaran passkey gagal diverifikasi.' });
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verified.registrationInfo;
    await this.repository.insertWebAuthn(
      userId,
      b64urlToBuffer(credential.id),
      Buffer.from(credential.publicKey),
      credential.counter,
      credential.transports ?? [],
      credentialDeviceType,
      credentialBackedUp,
    );
    await this.audit.record({
      action: 'partner.passkey_registered',
      objectType: 'device',
      objectId: userId,
      requestId: context.requestId,
      ipHash: context.ipHash,
      payload: { deviceType: credentialDeviceType, backedUp: credentialBackedUp },
    });
  }

  async list(
    userId: string,
  ): Promise<{ id: string; deviceType: string | null; lastUsedAt: string | null }[]> {
    const rows = await this.repository.listWebAuthnByUserId(userId);
    return rows.map((row) => ({
      id: row.id,
      deviceType: row.deviceType,
      lastUsedAt: row.lastUsedAt === null ? null : row.lastUsedAt.toISOString(),
    }));
  }

  async remove(userId: string, passkeyId: string): Promise<void> {
    await this.repository.deleteWebAuthn(userId, passkeyId);
  }

  async beginAuthentication(userId: string): Promise<{
    challengeId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
    allowed: boolean;
  }> {
    const existing = await this.repository.listWebAuthnByUserId(userId);
    if (existing.length === 0) {
      return {
        challengeId: '',
        options: await generateAuthenticationOptions({ rpID: WEBAUTHN.rpId }),
        allowed: false,
      };
    }

    const options = await generateAuthenticationOptions({
      rpID: WEBAUTHN.rpId,
      allowCredentials: existing.map((credential) => ({
        id: bufferToB64url(credential.credentialId),
        transports: credential.transports as never,
      })),
      userVerification: 'required',
    });

    const challengeId = await this.repository.insertWebAuthnChallenge(
      userId,
      options.challenge,
      'authentication',
      new Date(Date.now() + WEBAUTHN.challengeTtlMs),
    );
    return { challengeId, options, allowed: true };
  }

  async finishAuthentication(
    challengeId: string,
    response: AuthenticationResponseJSON,
    context: PasskeyAuditContext,
    now: Date = new Date(),
  ): Promise<string | null> {
    const challenge = await this.repository.consumeWebAuthnChallenge(challengeId);
    if (challenge === null) {
      return null;
    }

    const stored = await this.repository.findWebAuthnByCredentialId(
      b64urlToBuffer(response.id),
    );
    if (stored === null) {
      await this.audit.record({
        action: 'partner.login_failed',
        objectType: 'device',
        requestId: context.requestId,
        ipHash: context.ipHash,
        payload: { reason: 'passkey_unknown' },
      });
      return null;
    }

    const credential: WebAuthnCredential = {
      id: response.id,
      publicKey: new Uint8Array(stored.publicKey),
      counter: stored.counter,
      transports: stored.transports as never,
    };

    try {
      const verified = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: WEBAUTHN.origin,
        expectedRPID: WEBAUTHN.rpId,
        credential,
        requireUserVerification: true,
      });
      if (!verified.verified) {
        return null;
      }

      const newCounter = verified.authenticationInfo.newCounter;
      if (newCounter !== 0 && newCounter <= stored.counter) {
        await this.audit.record({
          action: 'partner.login_failed',
          objectType: 'device',
          objectId: stored.userId,
          requestId: context.requestId,
          ipHash: context.ipHash,
          payload: { reason: 'passkey_counter_regression', stored: stored.counter, seen: newCounter },
        });
        return null;
      }

      await this.repository.updateWebAuthnCounter(stored.id, newCounter, now);
      return stored.userId;
    } catch {
      await this.audit.record({
        action: 'partner.login_failed',
        objectType: 'device',
        objectId: stored.userId,
        requestId: context.requestId,
        ipHash: context.ipHash,
        payload: { reason: 'passkey_verification_error' },
      });
      return null;
    }
  }
}
