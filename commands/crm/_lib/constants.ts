export const CRM_API_BASE = '/crm/v3';

export const OBJECT_TYPES = [
  'contacts',
  'companies',
  'deals',
  'tickets',
  'line_items',
  'products',
  'quotes',
] as const;

export type CrmObjectType = (typeof OBJECT_TYPES)[number];

export const DEFAULT_PROPERTIES: Record<string, string[]> = {
  contacts: [
    'firstname',
    'lastname',
    'email',
    'company',
    'phone',
    'lifecyclestage',
  ],
  companies: [
    'name',
    'domain',
    'industry',
    'city',
    'country',
    'numberofemployees',
  ],
  deals: [
    'dealname',
    'dealstage',
    'amount',
    'closedate',
    'pipeline',
    'hubspot_owner_id',
  ],
  tickets: [
    'subject',
    'content',
    'hs_pipeline',
    'hs_pipeline_stage',
    'hs_ticket_priority',
    'createdate',
  ],
  line_items: ['name', 'quantity', 'price', 'amount'],
  products: ['name', 'description', 'price', 'hs_sku'],
  quotes: ['hs_title', 'hs_expiration_date', 'hs_status'],
};
