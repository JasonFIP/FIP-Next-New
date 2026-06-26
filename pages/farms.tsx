/**
 * /farms — farm management for advisors.
 *
 * List the farms you advise, create new ones, and edit each farm's nutrition
 * profile (the fields the Dairy Brain uses as context). Scoped server-side:
 * farmers are redirected away; the API only returns/edits farms you're a
 * member of.
 */

import { useEffect, useState, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import type { GetServerSideProps } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase-server';

type Props = { firstName: string | null; role: string };

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const supabase = createSupabaseServerClient(ctx.req as any, ctx.res as any);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { redirect: { destination: '/signin', permanent: false } };

  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, role')
    .eq('id', user.id)
    .single();
  if (!profile) return { redirect: { destination: '/signin', permanent: false } };
  // Farmers don't manage farms.
  if (profile.role === 'farmer')
    return { redirect: { destination: '/inbox', permanent: false } };

  return { props: { firstName: profile.first_name, role: profile.role } };
};

const ISLANDS = ['North Island', 'South Island'];
const STAGES = [
  'Dry / far-off',
  'Springer / transition',
  'Early lactation',
  'Peak lactation',
  'Mid lactation',
  'Late lactation',
];
const DELIVERY = [
  'In-shed feed system',
  'Dosing bin',
  'Mixer / feed wagon',
  'In-water dispenser',
  'Loose lick',
  'Dusting',
];

type Farm = {
  id: string;
  name: string;
  region: string | null;
  island: string | null;
  herd_size: number | null;
  supply_company: string | null;
  diet: string | null;
  mineral_delivery: string | null;
  production_stage: string | null;
  milk_urea: number | null;
  milk_protein: number | null;
  milk_fat: number | null;
  herd_test_date: string | null;
  notes: string | null;
  _membership_role?: string;
};

const BLANK: Partial<Farm> = {
  name: '',
  region: '',
  island: '',
  herd_size: null,
  supply_company: '',
  diet: '',
  mineral_delivery: '',
  production_stage: '',
  milk_urea: null,
  milk_protein: null,
  milk_fat: null,
  herd_test_date: '',
  notes: '',
};

export default function FarmsPage({ firstName, role }: Props) {
  const [farms, setFarms] = useState<Farm[]>([]);
  const [regionOptions, setRegionOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<null | 'new' | Farm>(null);
  const [form, setForm] = useState<Partial<Farm>>(BLANK);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/farms');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load farms');
      setFarms(data.farms || []);
      setRegionOptions(data.regionOptions || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openNew() {
    setForm({ ...BLANK });
    setEditing('new');
  }
  function openEdit(f: Farm) {
    setForm({
      ...f,
      region: f.region ?? '',
      island: f.island ?? '',
      herd_test_date: f.herd_test_date ?? '',
    });
    setEditing(f);
  }
  function close() {
    setEditing(null);
    setError(null);
  }
  function set<K extends keyof Farm>(key: K, value: any) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    if (!form.name || !String(form.name).trim()) {
      setError('Farm name is required.');
      return;
    }
    if (!form.region) {
      setError('Region is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const isNew = editing === 'new';
      const res = await fetch('/api/farms', {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isNew ? form : { ...form, id: (editing as Farm).id }),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 207)
        throw new Error(data.error || 'Save failed');
      if (data.warning) setError(data.warning);
      await load();
      if (!data.warning) close();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const canEdit = (f: Farm) =>
    role === 'admin' ||
    f._membership_role === 'primary_consultant' ||
    f._membership_role === 'consultant';

  function summary(f: Farm) {
    return [f.region, f.island, f.herd_size ? `${f.herd_size} cows` : null, f.production_stage]
      .filter(Boolean)
      .join(' · ');
  }

  return (
    <>
      <Head>
        <title>Farms · Agvance Dairy Brain</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main className="page">
        <header className="hd">
          <Link href="/" className="back">
            ← Home
          </Link>
          <h1>Farms</h1>
          <button className="btn-primary" onClick={openNew}>
            + New farm
          </button>
        </header>

        {error && !editing && <div className="err">{error}</div>}

        {loading ? (
          <div className="muted">Loading farms…</div>
        ) : farms.length === 0 ? (
          <div className="empty">
            <p>No farms yet.</p>
            <p className="muted">
              Create one to store its nutrition profile — the Dairy Brain uses it
              as context, and it scopes the review queue.
            </p>
            <button className="btn-primary" onClick={openNew}>
              + New farm
            </button>
          </div>
        ) : (
          <div className="grid">
            {farms.map((f) => (
              <button
                key={f.id}
                className="card"
                onClick={() => canEdit(f) && openEdit(f)}
                disabled={!canEdit(f)}
              >
                <div className="card-top">
                  <span className="fn">{f.name}</span>
                  {f._membership_role && (
                    <span className="role">
                      {f._membership_role.replace('_', ' ')}
                    </span>
                  )}
                </div>
                <div className="fm">{summary(f) || 'No details yet'}</div>
                {f.diet && <div className="fd">{f.diet}</div>}
                {(f.milk_urea != null ||
                  f.milk_protein != null ||
                  f.milk_fat != null) && (
                  <div className="ht">
                    Herd test — MU {f.milk_urea ?? '–'} · Prot{' '}
                    {f.milk_protein ?? '–'}% · Fat {f.milk_fat ?? '–'}%
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </main>

      {/* Create / edit modal */}
      {editing && (
        <div className="overlay" onClick={close}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <h2>{editing === 'new' ? 'New farm' : form.name || 'Edit farm'}</h2>
              <button className="x" onClick={close} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="row2">
                <Field label="Farm name *">
                  <input
                    value={form.name ?? ''}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="e.g. Hauraki Dairies"
                  />
                </Field>
                <Field label="Region *">
                  <select
                    value={form.region ?? ''}
                    onChange={(e) => set('region', e.target.value)}
                  >
                    <option value="">— select —</option>
                    {regionOptions.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="row2">
                <Field label="Island">
                  <select
                    value={form.island ?? ''}
                    onChange={(e) => set('island', e.target.value)}
                  >
                    <option value="">—</option>
                    {ISLANDS.map((i) => (
                      <option key={i}>{i}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Herd size">
                  <input
                    type="number"
                    value={form.herd_size ?? ''}
                    onChange={(e) => set('herd_size', e.target.value)}
                    placeholder="e.g. 420"
                  />
                </Field>
              </div>

              <div className="row2">
                <Field label="Production stage">
                  <select
                    value={form.production_stage ?? ''}
                    onChange={(e) => set('production_stage', e.target.value)}
                  >
                    <option value="">—</option>
                    {STAGES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Mineral delivery">
                  <select
                    value={form.mineral_delivery ?? ''}
                    onChange={(e) => set('mineral_delivery', e.target.value)}
                  >
                    <option value="">—</option>
                    {DELIVERY.map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Diet / feeds">
                <input
                  value={form.diet ?? ''}
                  onChange={(e) => set('diet', e.target.value)}
                  placeholder="e.g. fodder beet + grass silage, or grass + PKE + maize"
                />
              </Field>

              <Field label="Supply company">
                <input
                  value={form.supply_company ?? ''}
                  onChange={(e) => set('supply_company', e.target.value)}
                  placeholder="optional"
                />
              </Field>

              <div className="ht-block">
                <div className="ht-label">Latest herd test</div>
                <div className="row3">
                  <Field label="Milk Urea (MU)">
                    <input
                      type="number"
                      step="0.1"
                      value={form.milk_urea ?? ''}
                      onChange={(e) => set('milk_urea', e.target.value)}
                    />
                  </Field>
                  <Field label="Protein %">
                    <input
                      type="number"
                      step="0.01"
                      value={form.milk_protein ?? ''}
                      onChange={(e) => set('milk_protein', e.target.value)}
                    />
                  </Field>
                  <Field label="Fat %">
                    <input
                      type="number"
                      step="0.01"
                      value={form.milk_fat ?? ''}
                      onChange={(e) => set('milk_fat', e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Herd test date">
                  <input
                    type="date"
                    value={form.herd_test_date ?? ''}
                    onChange={(e) => set('herd_test_date', e.target.value)}
                  />
                </Field>
              </div>

              <Field label="Notes">
                <textarea
                  value={form.notes ?? ''}
                  onChange={(e) => set('notes', e.target.value)}
                  placeholder="Soil type, history, current products…"
                />
              </Field>

              {error && <div className="err">{error}</div>}
            </div>
            <div className="modal-f">
              <button className="btn" onClick={close} disabled={saving}>
                Cancel
              </button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : editing === 'new' ? 'Create farm' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .page {
          max-width: 880px;
          margin: 0 auto;
          padding: 24px 20px 60px;
          color: var(--star);
          min-height: 100vh;
        }
        .hd {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 26px;
        }
        .hd h1 {
          font-size: 1.5rem;
          margin: 0;
          flex: 1;
        }
        .back {
          color: var(--star-dim);
          text-decoration: none;
          font-size: 0.9rem;
        }
        .back:hover {
          color: var(--star);
        }
        .muted {
          color: var(--muted);
          font-size: 0.92rem;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 14px;
        }
        .card {
          text-align: left;
          background: var(--ink-2);
          border: 1px solid var(--line);
          border-radius: 13px;
          padding: 16px 17px;
          cursor: pointer;
          color: var(--star);
          font: inherit;
          transition: border-color 0.15s, transform 0.15s;
        }
        .card:hover:not(:disabled) {
          border-color: var(--line-2);
          transform: translateY(-2px);
        }
        .card:disabled {
          cursor: default;
          opacity: 0.75;
        }
        .card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .fn {
          font-weight: 600;
          font-size: 1.02rem;
        }
        .role {
          font-size: 0.66rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--horizon);
          border: 1px solid var(--line-2);
          border-radius: 999px;
          padding: 2px 8px;
          white-space: nowrap;
        }
        .fm {
          color: var(--star-dim);
          font-size: 0.85rem;
          margin-top: 5px;
        }
        .fd {
          color: var(--muted);
          font-size: 0.82rem;
          margin-top: 6px;
        }
        .ht {
          color: var(--moss);
          font-size: 0.78rem;
          margin-top: 8px;
        }
        .empty {
          text-align: center;
          padding: 60px 20px;
          line-height: 1.7;
        }
        .empty p {
          margin: 0 0 6px;
        }
        .empty .btn-primary {
          margin-top: 16px;
        }
        .btn-primary {
          background: var(--horizon);
          color: #1a1408;
          border: none;
          border-radius: 9px;
          padding: 9px 18px;
          font-weight: 600;
          font-size: 0.88rem;
          cursor: pointer;
        }
        .btn-primary:hover {
          filter: brightness(1.08);
        }
        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .btn {
          background: transparent;
          border: 1px solid var(--line-2);
          color: var(--star);
          border-radius: 9px;
          padding: 9px 18px;
          font-size: 0.88rem;
          cursor: pointer;
        }
        .btn:hover {
          border-color: var(--star-dim);
        }
        .err {
          background: rgba(200, 79, 58, 0.12);
          border: 1px solid rgba(200, 79, 58, 0.4);
          color: #e8907f;
          border-radius: 9px;
          padding: 10px 13px;
          font-size: 0.85rem;
          margin-bottom: 16px;
        }
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(6, 9, 14, 0.66);
          backdrop-filter: blur(3px);
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 40px 16px;
          overflow: auto;
          z-index: 50;
        }
        .modal {
          background: var(--ink-2);
          border: 1px solid var(--line-2);
          border-radius: 16px;
          width: 100%;
          max-width: 560px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        }
        .modal-h {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 22px;
          border-bottom: 1px solid var(--line);
        }
        .modal-h h2 {
          margin: 0;
          font-size: 1.1rem;
        }
        .x {
          background: none;
          border: none;
          color: var(--muted);
          font-size: 1.6rem;
          line-height: 1;
          cursor: pointer;
        }
        .x:hover {
          color: var(--star);
        }
        .modal-body {
          padding: 18px 22px;
        }
        .modal-f {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding: 16px 22px;
          border-top: 1px solid var(--line);
        }
        .row2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .row3 {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 10px;
        }
        .ht-block {
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid var(--line);
          border-radius: 10px;
          padding: 12px 13px;
          margin: 4px 0 12px;
        }
        .ht-label {
          font-size: 0.78rem;
          color: var(--star-dim);
          margin-bottom: 8px;
        }
        @media (max-width: 520px) {
          .row2 {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      <style jsx>{`
        .field {
          display: block;
          margin-bottom: 12px;
        }
        .field span {
          display: block;
          font-size: 0.78rem;
          color: var(--star-dim);
          margin-bottom: 5px;
        }
        .field :global(input),
        .field :global(select),
        .field :global(textarea) {
          width: 100%;
          background: rgba(0, 0, 0, 0.28);
          border: 1px solid var(--line-2);
          border-radius: 8px;
          color: var(--star);
          padding: 9px 11px;
          font-size: 0.88rem;
          font-family: inherit;
        }
        .field :global(textarea) {
          resize: vertical;
          min-height: 52px;
          line-height: 1.5;
        }
        .field :global(input:focus),
        .field :global(select:focus),
        .field :global(textarea:focus) {
          outline: none;
          border-color: var(--horizon);
        }
      `}</style>
    </label>
  );
}
