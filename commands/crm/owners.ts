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
import { commands } from '../../lang/en.js';
import { makeYargsBuilder } from '../../lib/yargsUtils.js';
import { trackCommandUsage } from '../../lib/usageTracking.js';
import {
  outputSuccess,
  outputError,
  outputTable,
  exitOk,
  exitError,
} from './_lib/output.js';

const command = 'owners';
const describe = commands.crm.subcommands.owners.describe;

type CrmOwnersArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    json?: boolean;
  };

type OwnerResult = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  userId: number;
  teams: { id: string; name: string }[];
};

type OwnersResponse = {
  results: OwnerResult[];
};

async function handler(args: ArgumentsCamelCase<CrmOwnersArgs>): Promise<void> {
  const { derivedAccountId } = args;
  void trackCommandUsage('crm-owners', {}, derivedAccountId);

  try {
    const response = await http.get<OwnersResponse>(derivedAccountId, {
      url: '/crm/v3/owners',
    });

    const { results } = response.data;

    outputSuccess(args, {
      command: 'crm.owners',
      account_id: derivedAccountId,
      data: results,
      total: results.length,
    });

    const tableHeader = [
      'ID',
      'Email',
      'First Name',
      'Last Name',
      'User ID',
      'Teams',
    ];
    const tableData = results.map(o => [
      o.id,
      o.email,
      o.firstName || '',
      o.lastName || '',
      String(o.userId || ''),
      (o.teams || []).map(t => t.name).join(', '),
    ]);

    outputTable(args, tableHeader, tableData);
    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.owners',
      derivedAccountId,
      'OWNERS_FETCH_FAILED',
      String(err)
    );
    exitError();
  }
}

function ownersBuilder(yargs: Argv): Argv<CrmOwnersArgs> {
  yargs.option('json', {
    describe: 'Output as JSON (for LLM/scripting)',
    type: 'boolean',
    default: false,
  });

  yargs.example([['$0 crm owners', 'List all owners in the account']]);
  return yargs as Argv<CrmOwnersArgs>;
}

const builder = makeYargsBuilder<CrmOwnersArgs>(
  ownersBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmOwnersCommand: YargsCommandModule<unknown, CrmOwnersArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmOwnersCommand;
