import { Router } from 'express';
import { auditRouter } from './modules/audit/audit.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { budgetAllocationRouter } from './modules/budget-allocation/budget-allocation.routes.js';
import { centresRouter } from './modules/centres/centres.routes.js';
import { financialYearsRouter } from './modules/financialYears/financialYears.routes.js';
import { metadataRouter } from './modules/metadata/metadata.routes.js';
import { mastersRouter } from './modules/masters/masters.routes.js';
import { parametersRouter } from './modules/parameters/parameters.routes.js';
import { experimentPisRouter } from './modules/experimentPis/experimentPis.routes.js';
import { experimentsRouter } from './modules/experiments/experiments.routes.js';
import { sheetsRouter } from './modules/sheets/sheets.routes.js';
import { trialsRouter } from './modules/trials/trials.routes.js';
import { usersRouter } from './modules/users/users.routes.js';

export const API_PREFIX = '/api/v1';

export interface ApiModule {
  /** Folder name in the generated Postman collection. */
  name: string;
  /** Mount path under API_PREFIX. */
  prefix: string;
  router: Router;
  /** Singular noun, used for request names ("Create centre") and the id variable ("centreId"). */
  singular: string;
  description: string;
}

/**
 * Every module router. This is the single list used both to mount the API and to generate
 * the Postman collection, so add new modules here and nowhere else.
 */
export const API_MODULES: readonly ApiModule[] = [
  {
    name: 'Auth',
    prefix: '/auth',
    router: authRouter,
    singular: 'session',
    description: 'Sign in and out. The session is an httpOnly cookie that Postman stores and resends.',
  },
  {
    name: 'Users',
    prefix: '/users',
    router: usersRouter,
    singular: 'user',
    description:
      'User accounts. Needs `users.manage`; each role can only create the roles it is allowed to (only the PCU and Super Administrator create PI and data-entry accounts).',
  },
  {
    name: 'Centres',
    prefix: '/centres',
    router: centresRouter,
    singular: 'centre',
    description:
      'Network and voluntary centres. Only the PCU and Super Administrator create or edit them (`centres.manage`). Everyone signed in can read them; PI and data-entry users see only their own centre.',
  },
  {
    name: 'Masters',
    prefix: '/masters',
    router: mastersRouter,
    singular: 'master',
    description:
      'Lookup lists (seasons, units, crops, NF inputs, programmes, budget heads, fund categories, staff posts). Everyone signed in reads them; `masters.edit` (PCU, Super Admin) changes them. Each list supports Excel import.',
  },
  {
    name: 'Financial years',
    prefix: '/financial-years',
    router: financialYearsRouter,
    singular: 'financialYear',
    description:
      'Indian financial years (1 April – 31 March). Closed years block data entry; one year is current.',
  },
  {
    name: 'Parameters',
    prefix: '/parameters',
    router: parametersRouter,
    singular: 'parameter',
    description:
      'The parameter library every experiment records against (name, unit, category, data type, limits, method). Supports Excel import.',
  },
  {
    name: 'Experiments',
    prefix: '/experiments',
    router: experimentsRouter,
    singular: 'experiment',
    description:
      'PCU experiment protocols: programme, design, replications, common treatments, parameters to record and seasons, assigned to centres. Centre users see the experiments assigned to them.',
  },
  {
    name: 'Experiment PIs',
    prefix: '/experiment-pis',
    router: experimentPisRouter,
    singular: 'experiment PI',
    description:
      'Experiment PI seats: permanent logins pi1.npnf@icar.org.in, pi2… created by the PCU (`research.assign` and `users.manage`), each held by one person at a time. Replacing the holder keeps the login and everything recorded under it. An Experiment PI sees and edits only the experiment linked to their seat.',
  },
  {
    name: 'Trials',
    prefix: '/trials',
    router: trialsRouter,
    singular: 'trial',
    description:
      'An experiment as run at one centre: its cropping systems, crops and varieties per season, practice details per treatment and in-charge. Created when the experiment is assigned.',
  },
  {
    name: 'Observation sheets',
    prefix: '/sheets',
    router: sheetsRouter,
    singular: 'sheet',
    description:
      'Data recording per trial × year × season: cell entry or Excel import, Draft → Submitted → Returned/Approved workflow, analysis (means, RCBD ANOVA) and cross-centre summary.',
  },
  {
    name: 'Metadata',
    prefix: '/metadata',
    router: metadataRouter,
    singular: 'metadata',
    description:
      "ICAR research-data metadata. Each centre fills its own part for its trial (`research.enter`, submit with `research.submit`); the PCU sets the fields common to the experiment (`research.config`) and returns or approves (`research.review` / `research.approve`). Every centre assigned to the experiment can read the others' metadata, but not change it.",
  },
  {
    name: 'Audit trail',
    prefix: '/audit',
    router: auditRouter,
    singular: 'audit',
    description:
      'Who did what, when and from where: every change (with old → new values), sign-ins and sign-outs. `audit.view`: PCU and Super Admin see everything; a Centre PI sees only their own centre.',
  },
  {
    name: 'Budget allocations',
    prefix: '/budget-allocations',
    router: budgetAllocationRouter,
    singular: 'budgetAllocation',
    description: 'Budget allocations per centre, financial year, budget head, and fund category.',
  },
];

export const routes = Router();

for (const module of API_MODULES) routes.use(module.prefix, module.router);
