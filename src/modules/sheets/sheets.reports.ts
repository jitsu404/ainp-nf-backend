import type { RequestContext } from '../../utils/context.js';
import { buildMultiSheetWorkbook } from '../../utils/excel.js';
import { experimentYears, getExperiment } from '../experiments/experiments.service.js';
import type { SummaryQuery, TrendQuery } from './sheets.dto.js';
import { analyseSheet, experimentSummary } from './sheets.service.js';

// Results built on the sheet service: trend across years and Excel exports of the analyses.

const mean = (xs: (number | null | undefined)[]) => {
  const ys = xs.filter((x): x is number => typeof x === 'number');
  return ys.length ? Math.round((ys.reduce((a, b) => a + b, 0) / ys.length) * 1000) / 1000 : null;
};

/**
 * Treatment means (mean of centres, approved sheets only) for every year of the experiment,
 * optionally for one season and/or one centre. Centre users get their own.
 */
export const experimentTrend = async (ctx: RequestContext, q: TrendQuery) => {
  const experiment = await getExperiment(ctx, q.experimentId); // 404 if not assigned to the caller
  const yearList = experimentYears(experiment);
  let parameters: Awaited<ReturnType<typeof experimentSummary>>['parameters'] = [];
  const years = [];
  for (const year of yearList) {
    const s = await experimentSummary(ctx, {
      experimentId: q.experimentId,
      year,
      seasonCode: q.seasonCode,
      includeUnapproved: false,
    });
    parameters = s.parameters;
    const centres = q.centreId ? s.centres.filter((c) => c.centre.id === q.centreId) : s.centres;
    const means: Record<string, Record<string, number | null>> = {};
    for (const p of s.parameters) {
      means[p.parameterId] = Object.fromEntries(
        experiment.treatments.map((t) => [
          t.code,
          mean(centres.map((c) => c.means[p.parameterId]?.[t.code])),
        ]),
      );
    }
    years.push({ year, sheets: centres.length, means });
  }
  // Years still to come with no data yet are left off the end.
  const thisYear = new Date().getFullYear();
  while (years.length > 1 && years.at(-1)!.year > thisYear && years.at(-1)!.sheets === 0) years.pop();
  return {
    experiment: {
      id: experiment.id as string,
      code: experiment.code,
      referenceTreatmentCode: experiment.referenceTreatmentCode ?? null,
    },
    treatments: experiment.treatments.map((t) => ({ code: t.code, name: t.name })),
    parameters,
    years,
  };
};

const label = (p: { name?: string | undefined; unitCode?: string | null | undefined }) =>
  `${p.name ?? ''}${p.unitCode ? ` (${p.unitCode})` : ''}`;
const pct = (value: number | null, ref: number | null | undefined) =>
  value === null || ref === null || ref === undefined || ref === 0
    ? null
    : Math.round(((value - ref) / Math.abs(ref)) * 1000) / 10;

/**
 * One sheet's analysis as Excel: treatment means (with DMRT and % vs reference) and the ANOVA
 * tables. Split plot, split-split plot and factorial designs get their own ANOVA (each factor,
 * interactions and error terms) and a "Factor means" tab with the mean of every factor level.
 */
export const exportSheetAnalysis = async (ctx: RequestContext, id: string) => {
  const a = await analyseSheet(ctx, id);
  const ref = a.experiment.referenceTreatmentCode;
  const names = new Map(a.treatments.map((t) => [t.code, t.name]));
  const meansRows = a.parameters.flatMap((p) => {
    const refMean = p.means.find((m) => m.treatmentCode === ref)?.mean;
    return p.means.map((m) => ({
      parameter: label(p),
      treatment: m.treatmentCode,
      name: names.get(m.treatmentCode),
      n: m.n,
      mean: m.mean,
      dmrt: p.anova?.groups?.[m.treatmentCode] ?? '',
      vsRef: ref && m.treatmentCode !== ref ? pct(m.mean, refMean) : null,
    }));
  });
  const anovaRows = a.parameters.flatMap((p) => anovaOf(p));
  const factorRows = a.parameters.flatMap((p) =>
    (p.factorial?.factorMeans ?? []).flatMap((f) =>
      f.levels.map((l) => ({
        parameter: label(p),
        factor: f.label,
        level: l.code,
        name: l.name ?? '',
        mean: l.mean,
      })),
    ),
  );
  const buffer = await buildMultiSheetWorkbook([
    {
      name: 'Treatment means',
      columns: [
        { key: 'parameter', header: 'Parameter', width: 36 },
        { key: 'treatment', header: 'Treatment' },
        { key: 'name', header: 'Name', width: 30 },
        { key: 'n', header: 'n' },
        { key: 'mean', header: 'Mean' },
        { key: 'dmrt', header: 'DMRT (5 %)' },
        { key: 'vsRef', header: ref ? `% vs ${ref}` : '% vs reference' },
      ],
      rows: meansRows,
    },
    ...(factorRows.length
      ? [
          {
            name: 'Factor means',
            columns: [
              { key: 'parameter', header: 'Parameter', width: 36 },
              { key: 'factor', header: 'Factor', width: 16 },
              { key: 'level', header: 'Level' },
              { key: 'name', header: 'Name', width: 28 },
              { key: 'mean', header: 'Mean' },
            ],
            rows: factorRows,
          },
        ]
      : []),
    {
      name: 'ANOVA',
      columns: [
        { key: 'parameter', header: 'Parameter', width: 36 },
        { key: 'source', header: 'Source', width: 40 },
        { key: 'df', header: 'df' },
        { key: 'ss', header: 'SS' },
        { key: 'ms', header: 'MS' },
        { key: 'f', header: 'F' },
        { key: 'p', header: 'p' },
      ],
      rows: anovaRows,
    },
  ]);
  return { buffer, filename: `${a.experiment.code}_${a.year}_${a.seasonCode}_analysis.xlsx` };
};

type SheetParameterAnalysis = Awaited<ReturnType<typeof analyseSheet>>['parameters'][number];

/** The ANOVA table of one parameter as export rows (or one row giving the reason there is none). */
const anovaOf = (p: SheetParameterAnalysis) =>
  p.factorial
    ? [
        ...p.factorial.table.map((r) => ({ parameter: label(p), ...r })),
        ...p.factorial.cv.map((c) => ({
          parameter: label(p),
          source: `CV ${c.error === 'Error' ? '' : `${c.error.replace('Error ', '')} `}${c.value} %`,
          df: null,
          ss: null,
          ms: null,
          f: null,
          p: null,
        })),
      ]
    : p.anova
      ? [
          ...p.anova.table.map((r) => ({ parameter: label(p), ...r })),
          {
            parameter: label(p),
            source: `CV ${p.anova.cv} %`,
            df: null,
            ss: null,
            ms: null,
            f: null,
            p: null,
          },
          {
            parameter: label(p),
            source: `SEm ± ${p.anova.sem}; SEd ± ${p.anova.sed}; CD (5 %) ${p.anova.cd5 ?? 'NS'}`,
            df: null,
            ss: null,
            ms: null,
            f: null,
            p: null,
          },
        ]
      : [
          {
            parameter: label(p),
            source: p.reason ?? 'No analysis of variance',
            df: null,
            ss: null,
            ms: null,
            f: null,
            p: null,
          },
        ];

/** The cross-centre summary as Excel: one row per centre and parameter, and the pooled analyses. */
export const exportSummary = async (ctx: RequestContext, q: SummaryQuery) => {
  const s = await experimentSummary(ctx, q);
  const ref = s.experiment.referenceTreatmentCode;
  const treatmentColumns = s.treatments.map((t) => ({
    key: t.code,
    header: `${t.code} ${t.name}`,
    width: 16,
  }));
  const centreRows = s.parameters.flatMap((p) => [
    ...s.centres.map((c) => ({
      parameter: label(p),
      centre: c.centre.name,
      system: c.croppingSystemName ?? c.croppingSystemCode ?? '',
      season: c.seasonCode,
      status: c.status,
      ...c.means[p.parameterId],
    })),
    {
      parameter: label(p),
      centre: 'Mean of centres',
      system: '',
      season: '',
      status: '',
      ...Object.fromEntries(
        s.treatments.map((t) => [t.code, mean(s.centres.map((c) => c.means[p.parameterId]?.[t.code]))]),
      ),
    },
  ]);
  const pooledRows = s.parameters.flatMap((p) => {
    const pooled = s.pooled[p.parameterId];
    if (!pooled) return [];
    if ('reason' in pooled) return [{ parameter: label(p), item: pooled.reason }];
    const refMean = pooled.means.find((m) => m.treatmentCode === ref)?.mean;
    return [
      ...pooled.means.map((m) => ({
        parameter: label(p),
        item: `${m.treatmentCode} mean`,
        value: m.mean,
        dmrt: pooled.groups?.[m.treatmentCode] ?? '',
        vsRef: ref && m.treatmentCode !== ref ? pct(m.mean, refMean) : null,
      })),
      ...pooled.table.map((r) => ({
        parameter: label(p),
        item: r.source,
        df: r.df,
        ss: r.ss,
        ms: r.ms,
        f: r.f,
        p: r.p,
      })),
      {
        parameter: label(p),
        item: `CV ${pooled.cv} %; SEm ± ${pooled.sem}; CD (5 %) ${pooled.cd5 ?? 'NS'}; Bartlett χ² ${pooled.bartlett.chiSquare} (p ${pooled.bartlett.p})`,
      },
      { parameter: label(p), item: `Locations: ${pooled.locations.join(', ')}` },
    ];
  });
  const buffer = await buildMultiSheetWorkbook([
    {
      name: 'Means by centre',
      columns: [
        { key: 'parameter', header: 'Parameter', width: 36 },
        { key: 'centre', header: 'Centre', width: 22 },
        { key: 'system', header: 'Cropping system', width: 24 },
        { key: 'season', header: 'Season' },
        { key: 'status', header: 'Status' },
        ...treatmentColumns,
      ],
      rows: centreRows,
    },
    {
      name: 'Pooled analysis',
      columns: [
        { key: 'parameter', header: 'Parameter', width: 36 },
        { key: 'item', header: 'Item', width: 50 },
        { key: 'value', header: 'Mean' },
        { key: 'dmrt', header: 'DMRT (5 %)' },
        { key: 'vsRef', header: ref ? `% vs ${ref}` : '% vs reference' },
        { key: 'df', header: 'df' },
        { key: 'ss', header: 'SS' },
        { key: 'ms', header: 'MS' },
        { key: 'f', header: 'F' },
        { key: 'p', header: 'p' },
      ],
      rows: pooledRows,
    },
  ]);
  return { buffer, filename: `${s.experiment.code}_${s.year}_summary.xlsx` };
};
