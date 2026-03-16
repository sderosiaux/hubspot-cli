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

const command = 'properties <object-type>';
const describe = 'List CRM object properties (schema)';

type CrmPropertiesArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    objectType: string;
    group?: string;
    json?: boolean;
  };

type CrmProperty = {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  groupName: string;
  description: string;
  calculated: boolean;
  hasUniqueValue: boolean;
};

type CrmPropertiesResponse = {
  results: CrmProperty[];
};

async function handler(
  args: ArgumentsCamelCase<CrmPropertiesArgs>
): Promise<void> {
  const { derivedAccountId, objectType, group, json } = args;
  void trackCommandUsage('crm-properties', {}, derivedAccountId);

  try {
    const response = await http.get<CrmPropertiesResponse>(derivedAccountId, {
      url: `/crm/v3/properties/${objectType}`,
    });

    let properties = response.data.results;

    if (group) {
      properties = properties.filter(p => p.groupName === group);
    }

    outputSuccess(args, {
      command: 'crm.properties',
      account_id: derivedAccountId,
      data: properties,
      total: properties.length,
    });

    if (!json) {
      const tableHeader = ['Name', 'Label', 'Type', 'Group', 'Description'];
      const tableData = properties.map(p => [
        p.name,
        p.label,
        p.type,
        p.groupName,
        (p.description || '').slice(0, 60),
      ]);
      outputTable(args, tableHeader, tableData);
    }

    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.properties',
      derivedAccountId,
      'API_ERROR',
      String(err)
    );
    exitError();
  }
}

function propertiesBuilder(yargs: Argv): Argv<CrmPropertiesArgs> {
  yargs
    .positional('object-type', {
      describe: 'CRM object type (contacts, companies, deals, tickets, etc.)',
      type: 'string',
    })
    .option('group', {
      describe: 'Filter properties by group name',
      type: 'string',
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm properties contacts', 'List all contact properties'],
    [
      '$0 crm properties deals --group "dealinformation"',
      'List deal properties in a specific group',
    ],
    ['$0 crm properties contacts --json', 'List properties as JSON'],
  ]);

  return yargs as Argv<CrmPropertiesArgs>;
}

const builder = makeYargsBuilder<CrmPropertiesArgs>(
  propertiesBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmPropertiesCommand: YargsCommandModule<unknown, CrmPropertiesArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmPropertiesCommand;
