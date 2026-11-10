import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ConsoleEmpty,
  ConsoleFailure,
  ConsoleHint,
  ConsolePanel,
  impactLabel,
  noticeKindLabel,
} from '../features/admin/console-ui';
import {
  createIncident,
  createNotice,
  fetchAdminCities,
  fetchAdminNotices,
  fetchHolidays,
  saveHoliday,
} from '../lib/admin-api';
import { describeError } from '../lib/errors';
import { stopsQuery } from '../lib/queries';
import { formatDateTime } from '../lib/time';

const NOTICE_KINDS = ['detour', 'repair', 'suspension', 'schedule', 'other'] as const;
const IMPACTS = ['minor', 'major', 'service_stopped', 'none'] as const;

function AdminContextPage() {
  const queryClient = useQueryClient();
  const cities = useQuery({
    queryKey: ['admin', 'cities'],
    queryFn: () => fetchAdminCities(),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const stops = useQuery(stopsQuery({ q: '', limit: 100 }));
  const holidays = useQuery({
    queryKey: ['admin', 'holidays'],
    queryFn: () => fetchHolidays({}),
    staleTime: 60_000,
    retry: false,
  });
  const notices = useQuery({
    queryKey: ['admin', 'notices'],
    queryFn: () => fetchAdminNotices({ limit: 20 }),
    staleTime: 30_000,
    retry: false,
  });

  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');
  const [holidayCity, setHolidayCity] = useState('');
  const [holidaySource, setHolidaySource] = useState('');
  const [holidayNotice, setHolidayNotice] = useState<string | null>(null);

  const [noticeKind, setNoticeKind] = useState<string>('detour');
  const [noticeText, setNoticeText] = useState('');
  const [noticeCity, setNoticeCity] = useState('');
  const [noticeStop, setNoticeStop] = useState('');
  const [noticeSource, setNoticeSource] = useState('');
  const [noticeStarts, setNoticeStarts] = useState('');
  const [noticeEnds, setNoticeEnds] = useState('');
  const [noticeSaved, setNoticeSaved] = useState<string | null>(null);

  const [incidentKind, setIncidentKind] = useState<string>('repair');
  const [incidentImpact, setIncidentImpact] = useState<string>('minor');
  const [incidentText, setIncidentText] = useState('');
  const [incidentStop, setIncidentStop] = useState('');
  const [incidentSource, setIncidentSource] = useState('');
  const [incidentStarts, setIncidentStarts] = useState('');
  const [incidentEnds, setIncidentEnds] = useState('');
  const [incidentSaved, setIncidentSaved] = useState<string | null>(null);

  const holidayMutation = useMutation({
    mutationFn: () =>
      saveHoliday({
        date: holidayDate,
        name: holidayName.trim(),
        cityId: holidayCity.length === 0 ? null : holidayCity,
        sourceUrl: holidaySource.trim(),
      }),
    retry: 0,
    onSuccess: (saved) => {
      setHolidayNotice(`${saved.name} (${saved.date}) tersimpan sebagai libur ${saved.scope === 'city' ? 'kota' : 'nasional'}.`);
      setHolidayName('');
      setHolidaySource('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'holidays'] });
      void queryClient.invalidateQueries({ queryKey: ['evidence'] });
    },
  });

  const noticeMutation = useMutation({
    mutationFn: () =>
      createNotice({
        kind: noticeKind,
        text: noticeText.trim(),
        sourceUrl: noticeSource.trim(),
        cityId: noticeCity.length === 0 ? null : noticeCity,
        stopId: noticeStop.length === 0 ? null : noticeStop,
        startsAt: noticeStarts.length === 0 ? null : new Date(noticeStarts).toISOString(),
        endsAt: noticeEnds.length === 0 ? null : new Date(noticeEnds).toISOString(),
      }),
    retry: 0,
    onSuccess: () => {
      setNoticeSaved('Pengumuman dicatat dan langsung tampil di panel konteks halte terkait.');
      setNoticeText('');
      setNoticeSource('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'notices'] });
      void queryClient.invalidateQueries({ queryKey: ['evidence'] });
    },
  });

  const incidentMutation = useMutation({
    mutationFn: () =>
      createIncident({
        kind: incidentKind,
        impact: incidentImpact,
        text: incidentText.trim(),
        sourceUrl: incidentSource.trim(),
        stopId: incidentStop.length === 0 ? null : incidentStop,
        startsAt: incidentStarts.length === 0 ? null : new Date(incidentStarts).toISOString(),
        endsAt: incidentEnds.length === 0 ? null : new Date(incidentEnds).toISOString(),
        publicVisible: true,
      }),
    retry: 0,
    onSuccess: () => {
      setIncidentSaved('Insiden dicatat sebagai konteks operasional.');
      setIncidentText('');
      setIncidentSource('');
      void queryClient.invalidateQueries({ queryKey: ['evidence'] });
    },
  });

  const holidayFailure = holidayMutation.isError ? describeError(holidayMutation.error) : null;
  const noticeFailure = noticeMutation.isError ? describeError(noticeMutation.error) : null;
  const incidentFailure = incidentMutation.isError ? describeError(incidentMutation.error) : null;

  return (
    <>
      <div className="page-head">
        <p className="label">Konteks operasional</p>
        <h1 className="page-title">Hari libur, pengumuman, insiden</h1>
        <p className="page-lede">
          Ketiganya membuat angka tunggu dibaca dengan benar. Tanpa konteks, penundaan akibat
          pengalihan rute akan tampak sebagai kelalaian operator.
        </p>
      </div>

      <ConsolePanel
        title="Hari libur"
        meta={holidays.data === undefined ? 'memuat' : `${String(holidays.data.length)} tanggal`}
      >
        {holidays.isPending ? (
          <ConsoleHint>Memuat kalender libur.</ConsoleHint>
        ) : holidays.isError ? (
          <ConsoleFailure
            title={describeError(holidays.error).title}
            detail={describeError(holidays.error).detail}
            onRetry={() => {
              void holidays.refetch();
            }}
          />
        ) : holidays.data.length === 0 ? (
          <ConsoleEmpty>Belum ada hari libur tercatat. Janji bercakupan libur tidak akan cocok.</ConsoleEmpty>
        ) : (
          <ul className="queue">
            {holidays.data.slice(0, 12).map((holiday) => (
              <li key={`${holiday.date}-${holiday.name}`} className="queue-row">
                <div className="queue-main">
                  <span className="queue-title">{holiday.date}</span>
                  <span className="queue-text">{holiday.name}</span>
                </div>
                <p className="queue-meta">
                  <span className={`chip chip--${holiday.scope === 'national' ? 'none' : 'indication'}`}>
                    {holiday.scope === 'national' ? 'nasional' : 'kota'}
                  </span>
                  <a href={holiday.sourceUrl} rel="noreferrer noopener" target="_blank">
                    sumber
                  </a>
                </p>
              </li>
            ))}
          </ul>
        )}

        <div className="console-form">
          <div className="field">
            <label htmlFor="holiday-date">Tanggal</label>
            <input
              id="holiday-date"
              type="date"
              value={holidayDate}
              onChange={(event) => {
                setHolidayDate(event.target.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="holiday-name">Nama</label>
            <input
              id="holiday-name"
              type="text"
              maxLength={120}
              value={holidayName}
              onChange={(event) => {
                setHolidayName(event.target.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="holiday-city">Cakupan</label>
            <select
              id="holiday-city"
              value={holidayCity}
              onChange={(event) => {
                setHolidayCity(event.target.value);
              }}
            >
              <option value="">Nasional</option>
              {(cities.data?.items ?? []).map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="holiday-source">URL sumber</label>
          <input
            id="holiday-source"
            type="url"
            maxLength={500}
            placeholder="https://"
            value={holidaySource}
            onChange={(event) => {
              setHolidaySource(event.target.value);
            }}
          />
        </div>

        {holidayFailure === null ? null : (
          <p className="field-error" role="alert">
            {holidayFailure.title}. {holidayFailure.detail}
          </p>
        )}
        {holidayNotice === null ? null : (
          <p className="console-notice" role="status">
            {holidayNotice}
          </p>
        )}

        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={
              holidayMutation.isPending ||
              holidayDate.length === 0 ||
              holidayName.trim().length === 0 ||
              holidaySource.trim().length === 0
            }
            onClick={() => {
              holidayMutation.mutate();
            }}
          >
            {holidayMutation.isPending ? 'Menyimpan…' : 'Simpan libur'}
          </button>
        </div>
      </ConsolePanel>

      <ConsolePanel
        title="Pengumuman"
        meta={notices.data === undefined ? 'memuat' : `${String(notices.data.length)} terbaru`}
      >
        {notices.isPending ? (
          <ConsoleHint>Memuat pengumuman.</ConsoleHint>
        ) : notices.isError ? (
          <ConsoleFailure
            title={describeError(notices.error).title}
            detail={describeError(notices.error).detail}
            onRetry={() => {
              void notices.refetch();
            }}
          />
        ) : notices.data.length === 0 ? (
          <ConsoleEmpty>Belum ada pengumuman yang menutup periode pengamatan.</ConsoleEmpty>
        ) : (
          <ul className="queue">
            {notices.data.map((notice) => (
              <li key={notice.id} className="queue-row">
                <div className="queue-main">
                  <span className="queue-title">{noticeKindLabel(notice.kind)}</span>
                  <span className="queue-text">{notice.text}</span>
                </div>
                <p className="queue-meta">
                  <span>{formatDateTime(notice.createdAt)}</span>
                  {notice.startsAt === null ? null : (
                    <span>
                      mulai {formatDateTime(notice.startsAt)}
                      {notice.endsAt === null ? '' : ` · sampai ${formatDateTime(notice.endsAt)}`}
                    </span>
                  )}
                  <a href={notice.sourceUrl} rel="noreferrer noopener" target="_blank">
                    sumber
                  </a>
                </p>
              </li>
            ))}
          </ul>
        )}

        <div className="console-form">
          <div className="field">
            <label htmlFor="notice-kind">Jenis</label>
            <select
              id="notice-kind"
              value={noticeKind}
              onChange={(event) => {
                setNoticeKind(event.target.value);
              }}
            >
              {NOTICE_KINDS.map((entry) => (
                <option key={entry} value={entry}>
                  {noticeKindLabel(entry)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="notice-city">Kota</label>
            <select
              id="notice-city"
              value={noticeCity}
              onChange={(event) => {
                setNoticeCity(event.target.value);
              }}
            >
              <option value="">Tanpa kota</option>
              {(cities.data?.items ?? []).map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="notice-stop">Halte</label>
            <select
              id="notice-stop"
              value={noticeStop}
              onChange={(event) => {
                setNoticeStop(event.target.value);
              }}
            >
              <option value="">Tanpa halte</option>
              {(stops.data?.items ?? []).map((stop) => (
                <option key={stop.id} value={stop.id}>
                  {stop.code} · {stop.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="notice-text">Isi pengumuman</label>
          <textarea
            id="notice-text"
            rows={3}
            maxLength={1000}
            value={noticeText}
            onChange={(event) => {
              setNoticeText(event.target.value);
            }}
          />
          <p className="field-hint">
            Minimal 10 karakter. Tulis apa yang berubah dan sampai kapan, bukan kode internal.
          </p>
        </div>

        <div className="console-form">
          <div className="field">
            <label htmlFor="notice-starts">Mulai</label>
            <input
              id="notice-starts"
              type="datetime-local"
              value={noticeStarts}
              onChange={(event) => {
                setNoticeStarts(event.target.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="notice-ends">Selesai</label>
            <input
              id="notice-ends"
              type="datetime-local"
              value={noticeEnds}
              onChange={(event) => {
                setNoticeEnds(event.target.value);
              }}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="notice-source">URL sumber</label>
          <input
            id="notice-source"
            type="url"
            maxLength={500}
            placeholder="https://"
            value={noticeSource}
            onChange={(event) => {
              setNoticeSource(event.target.value);
            }}
          />
        </div>

        {noticeFailure === null ? null : (
          <p className="field-error" role="alert">
            {noticeFailure.title}. {noticeFailure.detail}
          </p>
        )}
        {noticeSaved === null ? null : (
          <p className="console-notice" role="status">
            {noticeSaved}
          </p>
        )}

        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={
              noticeMutation.isPending ||
              noticeText.trim().length < 10 ||
              noticeSource.trim().length === 0 ||
              (noticeCity.length === 0 && noticeStop.length === 0)
            }
            onClick={() => {
              noticeMutation.mutate();
            }}
          >
            {noticeMutation.isPending ? 'Menyimpan…' : 'Catat pengumuman'}
          </button>
        </div>
      </ConsolePanel>

      <ConsolePanel title="Insiden">
        <p className="console-hint">
          Insiden dipakai menghitung gangguan yang menutup periode, bukan untuk menghapus
          pengamatan. Pengamatan tetap dihitung, hanya diberi catatan.
        </p>

        <div className="console-form">
          <div className="field">
            <label htmlFor="incident-kind">Jenis</label>
            <select
              id="incident-kind"
              value={incidentKind}
              onChange={(event) => {
                setIncidentKind(event.target.value);
              }}
            >
              {NOTICE_KINDS.map((entry) => (
                <option key={entry} value={entry}>
                  {noticeKindLabel(entry)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="incident-impact">Dampak</label>
            <select
              id="incident-impact"
              value={incidentImpact}
              onChange={(event) => {
                setIncidentImpact(event.target.value);
              }}
            >
              {IMPACTS.map((entry) => (
                <option key={entry} value={entry}>
                  {impactLabel(entry)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="incident-stop">Halte</label>
            <select
              id="incident-stop"
              value={incidentStop}
              onChange={(event) => {
                setIncidentStop(event.target.value);
              }}
            >
              <option value="">Tanpa halte</option>
              {(stops.data?.items ?? []).map((stop) => (
                <option key={stop.id} value={stop.id}>
                  {stop.code} · {stop.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="incident-text">Keterangan</label>
          <textarea
            id="incident-text"
            rows={3}
            maxLength={1000}
            value={incidentText}
            onChange={(event) => {
              setIncidentText(event.target.value);
            }}
          />
        </div>

        <div className="console-form">
          <div className="field">
            <label htmlFor="incident-starts">Mulai</label>
            <input
              id="incident-starts"
              type="datetime-local"
              value={incidentStarts}
              onChange={(event) => {
                setIncidentStarts(event.target.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="incident-ends">Selesai</label>
            <input
              id="incident-ends"
              type="datetime-local"
              value={incidentEnds}
              onChange={(event) => {
                setIncidentEnds(event.target.value);
              }}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="incident-source">URL sumber</label>
          <input
            id="incident-source"
            type="url"
            maxLength={500}
            placeholder="https://"
            value={incidentSource}
            onChange={(event) => {
              setIncidentSource(event.target.value);
            }}
          />
        </div>

        {incidentFailure === null ? null : (
          <p className="field-error" role="alert">
            {incidentFailure.title}. {incidentFailure.detail}
          </p>
        )}
        {incidentSaved === null ? null : (
          <p className="console-notice" role="status">
            {incidentSaved}
          </p>
        )}

        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={
              incidentMutation.isPending ||
              incidentText.trim().length < 10 ||
              incidentSource.trim().length === 0
            }
            onClick={() => {
              incidentMutation.mutate();
            }}
          >
            {incidentMutation.isPending ? 'Menyimpan…' : 'Catat insiden'}
          </button>
        </div>
      </ConsolePanel>
    </>
  );
}

export const Route = createFileRoute('/admin/konteks')({
  component: AdminContextPage,
});
