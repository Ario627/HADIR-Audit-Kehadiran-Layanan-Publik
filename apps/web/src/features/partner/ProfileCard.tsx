import type { PartnerProfile } from '@hadir/contracts';
import { roleLabel, sessionAgeText } from '../../lib/partner';
import { formatDateTime } from '../../lib/time';

export interface ProfileCardProps {
  profile: PartnerProfile;
  sessionCreatedAt: string | null;
  now: number;
}

const ROLE_NOTES: Record<PartnerProfile['role'], string> = {
  viewer: 'Bisa membaca inbox dan mengelola passkey akunnya sendiri. Tidak bisa mengubah status laporan.',
  responder: 'Bisa mengubah status laporan dan membuat ekspor data.',
  admin: 'Bisa mengubah status, mengelola passkey, dan memutus semua sesi instansi.',
};

export function ProfileCard({ profile, sessionCreatedAt, now }: ProfileCardProps) {
  return (
    <section className="settings-block" aria-labelledby="profile-title">
      <h2 className="section-title" id="profile-title">
        Akun &amp; instansi
      </h2>

      <dl className="facts">
        <div>
          <dt>Nama</dt>
          <dd>{profile.displayName}</dd>
        </div>
        <div>
          <dt>Instansi</dt>
          <dd>{profile.institutionName}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{roleLabel(profile.role)}</dd>
        </div>
        <div>
          <dt>Sesi berlaku sampai</dt>
          <dd>{formatDateTime(profile.expiresAt)}</dd>
        </div>
        {sessionCreatedAt === null ? null : (
          <div>
            <dt>Umur sesi</dt>
            <dd>{sessionAgeText(sessionCreatedAt, now)}</dd>
          </div>
        )}
      </dl>

      <p className="settings-meta">{ROLE_NOTES[profile.role]}</p>
      <p className="note">
        Mengubah nama, instansi, atau role hanya bisa dilakukan admin instansi lewat basis data; halaman
        ini tidak menyediakan formulir untuk itu agar perubahan wewenang selalu punya jejak audit.
      </p>
    </section>
  );
}