import { activeCentreCount } from '../centres/centres.service.js';
import { publicExperiments } from '../experiments/experiments.service.js';
import { activeTrialCounts } from '../trials/trials.service.js';

// What the public landing page shows without signing in: how many centres the network has and,
// for each experiment running now, how many centres run it. Nothing about people, data or
// results: only codes, titles and counts.

export const publicSummary = async () => {
  const [centres, experiments] = await Promise.all([activeCentreCount(), publicExperiments()]);
  const counts = await activeTrialCounts(experiments.map((e) => String(e._id)));
  return {
    centres,
    experiments: experiments.map((e) => ({
      code: e.code,
      title: e.title,
      programmeCode: e.programmeCode,
      design: e.design,
      startYear: e.startYear,
      endYear: e.endYear,
      centres: counts.get(String(e._id)) ?? 0,
    })),
  };
};
