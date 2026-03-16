import { Argv, ArgumentsCamelCase } from 'yargs';
import { http } from '@hubspot/local-dev-lib/http';
import {
  CommonArgs,
  ConfigArgs,
  AccountArgs,
  EnvironmentArgs,
  YargsCommandModule,
} from '../../types/Yargs.js';
import { uiLogger } from '../../lib/ui/logger.js';
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

const command = 'schema';
const describe = 'Discover CRM object types and their property counts';

type CrmSchemaArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    objectType?: string;
    json?: boolean;
  };

type CrmProperty = {
  name: string;
  label: string;
  type: string;
  groupName: string;
  description: string;
};

type CrmPropertiesResponse = {
  results: CrmProperty[];
};

type CrmPipeline = {
  id: string;
  label: string;
  stages: { id: string; label: string }[];
};

type CrmPipelinesResponse = {
  results: CrmPipeline[];
};

const STANDARD_OBJECT_TYPES = [
  'contacts',
  'companies',
  'deals',
  'tickets',
  'products',
  'line_items',
  'quotes',
];

const PIPELINE_OBJECT_TYPES = ['deals', 'tickets'];

async function fetchProperties(
  accountId: number,
  objectType: string
): Promise<CrmProperty[]> {
  try {
    const response = await http.get<CrmPropertiesResponse>(accountId, {
      url: `/crm/v3/properties/${objectType}`,
    });
    return response.data.results;
  } catch {
    return [];
  }
}

async function fetchPipelines(
  accountId: number,
  objectType: string
): Promise<CrmPipeline[]> {
  if (!PIPELINE_OBJECT_TYPES.includes(objectType)) {
    return [];
  }
  try {
    const response = await http.get<CrmPipelinesResponse>(accountId, {
      url: `/crm/v3/pipelines/${objectType}`,
    });
    return response.data.results;
  } catch {
    return [];
  }
}

async function handler(args: ArgumentsCamelCase<CrmSchemaArgs>): Promise<void> {
  const { derivedAccountId, objectType, json } = args;
  void trackCommandUsage('crm-schema', {}, derivedAccountId);

  try {
    if (objectType) {
      // Detailed schema for a single object type
      const [properties, pipelines] = await Promise.all([
        fetchProperties(derivedAccountId, objectType),
        fetchPipelines(derivedAccountId, objectType),
      ]);

      outputSuccess(args, {
        command: 'crm.schema',
        account_id: derivedAccountId,
        data: {
          objects: [
            {
              type: objectType,
              propertyCount: properties.length,
              properties,
              pipelines: pipelines.length > 0 ? pipelines : undefined,
            },
          ],
        },
      });

      const tableHeader = ['Name', 'Label', 'Type', 'Group'];
      const tableData = properties.map(p => [
        p.name,
        p.label,
        p.type,
        p.groupName,
      ]);
      outputTable(args, tableHeader, tableData);

      if (!json && pipelines.length > 0) {
        uiLogger.log('');
        uiLogger.success(`Pipelines (${pipelines.length}):`);
        uiLogger.log('');
        const pipelineHeader = ['Pipeline ID', 'Label', 'Stages'];
        const pipelineData = pipelines.map(p => [
          p.id,
          p.label,
          p.stages.map(s => s.label).join(', '),
        ]);
        outputTable(args, pipelineHeader, pipelineData);
      }

      exitOk();
    }

    // Overview: all standard object types with property counts
    const results = await Promise.all(
      STANDARD_OBJECT_TYPES.map(async type => {
        const properties = await fetchProperties(derivedAccountId, type);
        return { type, propertyCount: properties.length };
      })
    );

    outputSuccess(args, {
      command: 'crm.schema',
      account_id: derivedAccountId,
      data: {
        objects: results,
      },
    });

    const tableHeader = ['Object Type', 'Property Count'];
    const tableData = results.map(r => [r.type, String(r.propertyCount)]);

    outputTable(args, tableHeader, tableData);
    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.schema',
      derivedAccountId,
      'SCHEMA_FETCH_FAILED',
      String(err)
    );
    exitError();
  }
}

function schemaBuilder(yargs: Argv): Argv<CrmSchemaArgs> {
  yargs
    .option('object-type', {
      alias: 't',
      describe:
        'Get detailed schema for a specific object type (includes properties + pipelines)',
      type: 'string',
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm schema', 'List all object types with property counts'],
    [
      '$0 crm schema -t deals',
      'Get detailed schema for deals (properties + pipelines)',
    ],
    ['$0 crm schema --json', 'Get schema overview as JSON'],
  ]);

  return yargs as Argv<CrmSchemaArgs>;
}

const builder = makeYargsBuilder<CrmSchemaArgs>(
  schemaBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmSchemaCommand: YargsCommandModule<unknown, CrmSchemaArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmSchemaCommand;
