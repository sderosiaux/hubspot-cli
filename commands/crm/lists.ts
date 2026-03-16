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

const command = 'lists';
const describe = 'List contact lists';

type CrmListsArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    limit?: number;
    json?: boolean;
  };

type ContactList = {
  listId: number;
  name: string;
  listType: string;
  metaData: {
    size: number;
  };
  createdAt: number;
  updatedAt: number;
};

type ContactListsResponse = {
  lists: ContactList[];
  'has-more': boolean;
  offset: number;
};

async function handler(args: ArgumentsCamelCase<CrmListsArgs>): Promise<void> {
  const { derivedAccountId, limit = 20 } = args;
  void trackCommandUsage('crm-lists', {}, derivedAccountId);

  try {
    const response = await http.get<ContactListsResponse>(derivedAccountId, {
      url: '/contacts/v1/lists',
      params: {
        count: String(limit),
      },
    });

    const { lists } = response.data;

    outputSuccess(args, {
      command: 'crm.lists',
      account_id: derivedAccountId,
      data: lists.map(l => ({
        listId: l.listId,
        name: l.name,
        listType: l.listType,
        size: l.metaData.size,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
      })),
      total: lists.length,
    });

    const tableHeader = ['List ID', 'Name', 'Type', 'Size'];
    const tableData = lists.map(l => [
      String(l.listId),
      l.name,
      l.listType,
      String(l.metaData.size),
    ]);

    outputTable(args, tableHeader, tableData);
    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.lists',
      derivedAccountId,
      'LISTS_FETCH_FAILED',
      String(err)
    );
    exitError();
  }
}

function listsBuilder(yargs: Argv): Argv<CrmListsArgs> {
  yargs
    .option('limit', {
      alias: 'l',
      describe: 'Max number of lists to return',
      type: 'number',
      default: 20,
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm lists', 'List contact lists'],
    ['$0 crm lists -l 50', 'List up to 50 contact lists'],
    ['$0 crm lists --json', 'List contact lists as JSON'],
  ]);

  return yargs as Argv<CrmListsArgs>;
}

const builder = makeYargsBuilder<CrmListsArgs>(
  listsBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmListsCommand: YargsCommandModule<unknown, CrmListsArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmListsCommand;
