import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { PartnerMemberList } from '@hadir/contracts';
import { describeError } from '../../lib/errors';
import {
  changeMemberRole,
  createInvite,
  invitesQuery,
  membersQuery,
  revokeInvite,
  revokeMember,
} from '../../lib/member-api';
import { abilitiesFor } from '../../lib/partner';
import { formatDateTime } from '../../lib/time';
import type { PartnerProfile } from '@hadir/contracts';

const ROLES = ['viewer', 'responder', 'admin'] as const;

const ROLE_LABEL: Readonly<Record<string, string>> = {
  viewer: 'pembaca',
  responder: 'penanggap',
  admin: 'admin instansi',
};

const ROLE_DETAIL: Readonly<Record<string, string>> = {
  viewer: 'Bisa membaca laporan dan berkas kasus.',
  responder: 'Bisa menanggapi dan menandai tindakan pada laporan.',
  admin: 'Bisa mengundang, mengubah peran, dan mencabut anggota.',
};

function MemberRow({
  member,
  canManage,
  activeAdmins,
}: {
  member: PartnerMemberList['members'][number];
  canManage: boolean;
  activeAdmins: number;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['partner', 'members'] });
  };

  const changeRole = useMutation({
    mutationFn: (role: string) => changeMemberRole(member.membershipId, role),
    retry: 0,
    onSuccess: refresh,
  });

  const revoke = useMutation({
    mutationFn: () => revokeMember(member.membershipId),
    retry: 0,
    onSuccess: () => {
      setConfirming(false);
      refresh();
    },
  });

  const failure =
    changeRole.isError ? describeError(changeRole.error)
      : revoke.isError ? describeError(revoke.error)
        : null;

  const lastAdmin = member.role === 'admin' && member.status === 'active' && activeAdmins <= 1;

  return (
    <li className="member-row">
      <div className="member-id">
        <p className="member-name">
          {member.displayName}
          {member.isSelf ? <span className="member-self">kamu</span> : null}
        </p>
        <p className="member-meta">
          <span className={`chip chip--${member.status === 'active' ? 'verified' : 'none'}`}>
            {member.status}
          </span>
          <span>{ROLE_LABEL[member.role] ?? member.role}</span>
          <span>bergabung {formatDateTime(member.createdAt)}</span>
          {member.lastSeenAt === null ? null : (
            <span>terakhir aktif {formatDateTime(member.lastSeenAt)}</span>
          )}
        </p>
      </div>

      {canManage ? (
        <div className="member-actions">
          <label className="member-role">
            <span className="visually-hidden">Peran {member.displayName}</span>
            <select
              value={member.role}
              disabled={changeRole.isPending || member.status !== 'active'}
              onChange={(event) => {
                changeRole.mutate(event.target.value);
              }}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </label>

          {confirming ? (
            <>
              <button
                type="button"
                className="btn btn--danger"
                disabled={revoke.isPending || lastAdmin}
                onClick={() => {
                  revoke.mutate();
                }}
              >
                {revoke.isPending ? 'Mencabut…' : 'Cabut akses'}
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Batal
              </button>
            </>
          ) : (
            <button
              type="button"
              className="link-button"
              disabled={member.isSelf || member.status !== 'active'}
              title={
                member.isSelf
                  ? 'Tidak bisa mencabut akses sendiri.'
                  : lastAdmin
                    ? 'Instansi harus menyisakan minimal satu admin aktif.'
                    : undefined
              }
              onClick={() => {
                setConfirming(true);
              }}
            >
              Cabut
            </button>
          )}
        </div>
      ) : null}

      {lastAdmin ? (
        <p className="member-warning">
          Satu-satunya admin aktif. Angkat anggota lain sebagai admin sebelum mencabut akses ini.
        </p>
      ) : null}

      {failure === null ? null : (
        <p className="field-error" role="alert">
          {failure.title}. {failure.detail}
        </p>
      )}
    </li>
  );
}

export function MemberPanel({ profile }: { profile: PartnerProfile }) {
  const queryClient = useQueryClient();
  const abilities = abilitiesFor(profile.role);
  const canManage = profile.role === 'admin';

  const members = useQuery(membersQuery());
  const invites = useQuery({ ...invitesQuery(), enabled: canManage });

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('responder');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () => createInvite(email.trim(), role),
    retry: 0,
    onSuccess: (result) => {
      setIssuedToken(result.inviteToken);
      setEmail('');
      setNotice(
        `Undangan untuk ${result.invite.emailMasked} berlaku sampai ${formatDateTime(result.expiresAt)}.`,
      );
      void queryClient.invalidateQueries({ queryKey: ['partner', 'invites'] });
    },
  });

  const cancelInvite = useMutation({
    mutationFn: (inviteId: string) => revokeInvite(inviteId),
    retry: 0,
    onSuccess: () => {
      setNotice('Undangan dibatalkan.');
      void queryClient.invalidateQueries({ queryKey: ['partner', 'invites'] });
    },
  });

  const failure =
    invite.isError ? describeError(invite.error)
      : cancelInvite.isError ? describeError(cancelInvite.error)
        : null;

  return (
    <>
      <section className="console-panel" aria-labelledby="members-title">
        <header className="console-panel-head">
          <h2 className="console-panel-title" id="members-title">
            Anggota instansi
          </h2>
          <p className="console-panel-meta">
            {members.data === undefined
              ? 'memuat'
              : `${String(members.data.members.length)} akun · ${String(members.data.activeAdmins)} admin aktif`}
          </p>
        </header>

        {members.isPending ? (
          <p className="console-hint">Memuat anggota.</p>
        ) : members.isError ? (
          <p className="field-error" role="alert">
            {describeError(members.error).title}. {describeError(members.error).detail}
          </p>
        ) : (
          <ul className="member-list">
            {members.data.members.map((member) => (
              <MemberRow
                key={member.membershipId}
                member={member}
                canManage={canManage}
                activeAdmins={members.data.activeAdmins}
              />
            ))}
          </ul>
        )}

        {members.data === undefined || members.data.caveats.length === 0 ? null : (
          <details className="console-more">
            <summary>Catatan</summary>
            <ul className="dossier-list">
              {members.data.caveats.map((caveat) => (
                <li key={caveat}>{caveat}</li>
              ))}
            </ul>
          </details>
        )}

        <p className="console-hint">
          Wewenangmu: {abilities.act ? 'menanggapi laporan' : 'membaca saja'}
          {canManage ? ', mengelola anggota' : ''}.
        </p>
      </section>

      {canManage ? (
        <>
          <section className="console-panel" aria-labelledby="invites-title">
            <header className="console-panel-head">
              <h2 className="console-panel-title" id="invites-title">
                Undangan terbuka
              </h2>
            </header>

            {invites.isPending ? (
              <p className="console-hint">Memuat undangan.</p>
            ) : invites.isError ? (
              <p className="field-error" role="alert">
                {describeError(invites.error).title}. {describeError(invites.error).detail}
              </p>
            ) : invites.data.length === 0 ? (
              <p className="console-empty">Belum ada undangan.</p>
            ) : (
              <ul className="queue">
                {invites.data.map((entry) => (
                  <li key={entry.inviteId} className="queue-row">
                    <div className="queue-main">
                      <span className="queue-title">{entry.emailMasked}</span>
                      <span className="queue-text">
                        {ROLE_LABEL[entry.role] ?? entry.role} · berlaku sampai{' '}
                        {formatDateTime(entry.expiresAt)}
                      </span>
                    </div>
                    <p className="queue-meta">
                      <span className={`chip chip--${entry.pending ? 'pending' : 'none'}`}>
                        {entry.pending ? 'menunggu' : entry.consumedAt === null ? 'dicabut' : 'dipakai'}
                      </span>
                    </p>
                    {entry.pending ? (
                      <div className="queue-actions">
                        <button
                          type="button"
                          className="link-button"
                          disabled={cancelInvite.isPending}
                          onClick={() => {
                            cancelInvite.mutate(entry.inviteId);
                          }}
                        >
                          Batalkan
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="console-panel" aria-labelledby="invite-form-title">
            <header className="console-panel-head">
              <h2 className="console-panel-title" id="invite-form-title">
                Undang anggota
              </h2>
            </header>

            <div className="console-form">
              <div className="field">
                <label htmlFor="invite-email">Email</label>
                <input
                  id="invite-email"
                  type="email"
                  maxLength={254}
                  value={email}
                  aria-describedby="invite-email-hint"
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setIssuedToken(null);
                  }}
                />
                <p className="field-hint" id="invite-email-hint">
                  Email disimpan tersamarkan. Tautan undangan hanya ditampilkan sekali di layar ini.
                </p>
              </div>
              <div className="field">
                <label htmlFor="invite-role">Peran</label>
                <select
                  id="invite-role"
                  value={role}
                  onChange={(event) => {
                    setRole(event.target.value);
                  }}
                >
                  {ROLES.map((entry) => (
                    <option key={entry} value={entry}>
                      {ROLE_LABEL[entry]}
                    </option>
                  ))}
                </select>
                <p className="field-hint">{ROLE_DETAIL[role]}</p>
              </div>
            </div>

            {failure === null ? null : (
              <p className="field-error" role="alert">
                {failure.title}. {failure.detail}
              </p>
            )}

            {notice === null ? null : (
              <p className="console-notice" role="status">
                {notice}
              </p>
            )}

            {issuedToken === null ? null : (
              <div className="token-box">
                <p className="token-label">Tautan undangan</p>
                <code className="token-value">{issuedToken}</code>
                <p className="field-hint">
                  Kirim lewat kanal internal. Token tidak bisa ditampilkan lagi setelah halaman ini
                  ditutup.
                </p>
              </div>
            )}

            <div className="actions">
              <button
                type="button"
                className="btn"
                disabled={invite.isPending || email.trim().length === 0}
                onClick={() => {
                  invite.mutate();
                }}
              >
                {invite.isPending ? 'Mengundang…' : 'Kirim undangan'}
              </button>
            </div>
          </section>
        </>
      ) : (
        <section className="console-panel">
          <p className="console-hint">
            Hanya admin instansi yang bisa mengundang atau mengubah peran anggota.
          </p>
        </section>
      )}
    </>
  );
}
