import { Argv, ArgumentsCamelCase } from 'yargs';
import { http } from '@hubspot/local-dev-lib/http';
import {
  CommonArgs,
  ConfigArgs,
  AccountArgs,
  EnvironmentArgs,
  YargsCommandModule,
} from '../../types/Yargs.js';
import { logError } from '../../lib/errorHandlers/index.js';
import { makeYargsBuilder } from '../../lib/yargsUtils.js';
import { trackCommandUsage } from '../../lib/usageTracking.js';
import {
  outputSuccess,
  outputError,
  outputTable,
  exitOk,
  exitError,
} from './_lib/output.js';

const command = ['forms', 'form'];
const describe = 'List marketing forms';

type FormsArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    limit?: number;
    includeArchived?: boolean;
    json?: boolean;
  };

type FormField = { name: string };
type FieldGroup = { fields?: FormField[] };

type HubSpotForm = {
  id: string;
  name: string;
  formType: string;
  fieldGroups: FieldGroup[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

type FormsResponse = {
  results: HubSpotForm[];
  paging?: { next?: { after?: string } };
};

async function handler(args: ArgumentsCamelCase<FormsArgs>): Promise<void> {
  const { derivedAccountId, limit = 20, includeArchived = false } = args;
  void trackCommandUsage('crm-forms', {}, derivedAccountId);

  try {
    const params: Record<string, string> = {
      limit: String(Math.min(limit, 100)),
    };
    if (!includeArchived) params.archived = 'false';

    const response = await http.get<FormsResponse>(derivedAccountId, {
      url: '/marketing/v3/forms/',
      params,
    });

    const { results } = response.data;

    const data = results.map(f => ({
      id: f.id,
      name: f.name,
      formType: f.formType,
      fieldsCount: f.fieldGroups.reduce(
        (n, g) => n + (g.fields?.length || 0),
        0
      ),
      archived: f.archived,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    }));

    outputSuccess(args, {
      command: 'crm.forms',
      account_id: derivedAccountId,
      data,
      total: results.length,
    });

    const tableHeader = ['ID', 'Name', 'Type', 'Fields', 'Created', 'Updated'];
    const tableData = data.map(f => [
      f.id,
      f.name,
      f.formType,
      String(f.fieldsCount),
      f.createdAt.split('T')[0],
      f.updatedAt.split('T')[0],
    ]);

    outputTable(args, tableHeader, tableData);
    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.forms',
      derivedAccountId,
      'FORMS_FETCH_FAILED',
      String(err)
    );
    exitError();
  }
}

function formsBuilder(yargs: Argv): Argv<FormsArgs> {
  yargs
    .option('limit', {
      alias: 'l',
      describe: 'Max number of forms to return',
      type: 'number',
      default: 20,
    })
    .option('include-archived', {
      describe: 'Include archived forms',
      type: 'boolean',
      default: false,
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm forms', 'List forms'],
    ['$0 crm forms --include-archived', 'Include archived forms'],
    ['$0 crm forms --json', 'JSON output'],
  ]);

  return yargs as Argv<FormsArgs>;
}

const builder = makeYargsBuilder<FormsArgs>(formsBuilder, command, describe, {
  useGlobalOptions: true,
  useConfigOptions: true,
  useAccountOptions: true,
  useEnvironmentOptions: true,
});

const crmFormsCommand: YargsCommandModule<unknown, FormsArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmFormsCommand;
