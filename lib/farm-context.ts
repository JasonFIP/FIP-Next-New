/**
 * Farm context for the chat.
 *
 * Loads a farm's full nutrition profile and formats it as a prompt block the
 * Dairy Brain can tailor its answer to. Used in both modes: a consultant's
 * selected farm, and a farmer's own farm. The same profile object is also
 * snapshotted into recommendations.farm_data_snapshot when a farmer draft is
 * created, so the review carries the farm state it was based on.
 */

// The service client is passed in; typed loosely to avoid schema-generic friction.
type Db = any;

export interface FarmProfile {
  name: string | null;
  region: string | null;
  island: string | null;
  herd_size: number | null;
  diet: string | null;
  mineral_delivery: string | null;
  production_stage: string | null;
  milk_urea: number | null;
  milk_protein: number | null;
  milk_fat: number | null;
  supply_company: string | null;
  notes: string | null;
}

const FARM_COLUMNS =
  'name, region, island, herd_size, diet, mineral_delivery, production_stage, milk_urea, milk_protein, milk_fat, supply_company, notes';

export async function loadFarmProfile(
  svc: Db,
  farmId: string
): Promise<FarmProfile | null> {
  const { data } = await svc
    .from('farms')
    .select(FARM_COLUMNS)
    .eq('id', farmId)
    .maybeSingle();
  return (data as FarmProfile) ?? null;
}

/** Render the profile as a system-prompt block. Returns '' if there's nothing useful. */
export function formatFarmContext(f: FarmProfile | null): string {
  if (!f) return '';

  const lines: string[] = [];
  if (f.name) lines.push(`Name: ${f.name}`);

  const loc = [f.region, f.island].filter(Boolean).join(', ');
  if (loc) lines.push(`Location: ${loc}`);

  if (f.herd_size != null) lines.push(`Herd size: ${f.herd_size} cows`);
  if (f.production_stage) lines.push(`Stage: ${f.production_stage}`);
  if (f.diet) lines.push(`Diet / feeds: ${f.diet}`);
  if (f.mineral_delivery)
    lines.push(
      `Mineral delivery: ${f.mineral_delivery} — apply the delivery-format gating rule to this.`
    );
  if (f.supply_company) lines.push(`Supply company: ${f.supply_company}`);

  const herdTest = [
    f.milk_urea != null ? `Milk Urea (MU) ${f.milk_urea}` : null,
    f.milk_protein != null ? `Protein ${f.milk_protein}%` : null,
    f.milk_fat != null ? `Fat ${f.milk_fat}%` : null,
  ].filter(Boolean);
  if (herdTest.length) lines.push(`Latest herd test: ${herdTest.join(', ')}`);

  if (f.notes) lines.push(`Notes: ${f.notes}`);

  if (!lines.length) return '';

  return [
    '# Active farm',
    'Tailor this answer to the farm below. Use its diet and latest herd test for the performance read, and obey the delivery-format gating rule for its mineral delivery. Where a detail is missing and it matters, ask for it.',
    '',
    ...lines,
  ].join('\n');
}
