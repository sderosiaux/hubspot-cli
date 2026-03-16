import * as z from 'zod';

// --- CRM Object ---

export const CrmObjectSchema = z
  .object({
    id: z.string(),
    properties: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
    updatedAt: z.string(),
    archived: z.boolean().optional(),
  })
  .passthrough();

export type CrmObject = z.infer<typeof CrmObjectSchema>;

// --- CRM List Response ---

export const CrmListResponseSchema = z
  .object({
    results: z.array(CrmObjectSchema),
    total: z.number().optional(),
    paging: z
      .object({
        next: z
          .object({
            after: z.string(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type CrmListResponse = z.infer<typeof CrmListResponseSchema>;

// --- CRM Owner ---

export const CrmOwnerSchema = z
  .object({
    id: z.string(),
    email: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    userId: z.number().optional(),
    teams: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

export type CrmOwner = z.infer<typeof CrmOwnerSchema>;

export const CrmOwnersResponseSchema = z
  .object({
    results: z.array(CrmOwnerSchema),
  })
  .passthrough();

export type CrmOwnersResponse = z.infer<typeof CrmOwnersResponseSchema>;

// --- CRM Pipeline ---

export const CrmPipelineStageSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    displayOrder: z.number(),
  })
  .passthrough();

export type CrmPipelineStage = z.infer<typeof CrmPipelineStageSchema>;

export const CrmPipelineSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    displayOrder: z.number(),
    stages: z.array(CrmPipelineStageSchema),
  })
  .passthrough();

export type CrmPipeline = z.infer<typeof CrmPipelineSchema>;

export const CrmPipelinesResponseSchema = z
  .object({
    results: z.array(CrmPipelineSchema),
  })
  .passthrough();

export type CrmPipelinesResponse = z.infer<typeof CrmPipelinesResponseSchema>;

// --- CRM Property ---

export const CrmPropertySchema = z
  .object({
    name: z.string(),
    label: z.string(),
    type: z.string(),
    fieldType: z.string(),
    description: z.string().optional(),
    groupName: z.string().optional(),
    options: z
      .array(
        z
          .object({
            label: z.string(),
            value: z.string(),
            displayOrder: z.number().optional(),
            hidden: z.boolean().optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

export type CrmProperty = z.infer<typeof CrmPropertySchema>;

export const CrmPropertiesResponseSchema = z
  .object({
    results: z.array(CrmPropertySchema),
  })
  .passthrough();

export type CrmPropertiesResponse = z.infer<typeof CrmPropertiesResponseSchema>;

// --- CRM Association ---

export const CrmAssociationSchema = z
  .object({
    toObjectId: z.union([z.string(), z.number()]),
    associationTypes: z.array(
      z
        .object({
          category: z.string(),
          typeId: z.number(),
          label: z.string().nullable().optional(),
        })
        .passthrough()
    ),
  })
  .passthrough();

export type CrmAssociation = z.infer<typeof CrmAssociationSchema>;

export const CrmAssociationsResponseSchema = z
  .object({
    results: z.array(CrmAssociationSchema),
    paging: z
      .object({
        next: z
          .object({
            after: z.string(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type CrmAssociationsResponse = z.infer<
  typeof CrmAssociationsResponseSchema
>;

// --- CRM Batch Response ---

export const CrmBatchResponseSchema = z
  .object({
    status: z.string(),
    results: z.array(CrmObjectSchema),
    errors: z
      .array(
        z
          .object({
            status: z.string().optional(),
            category: z.string().optional(),
            message: z.string(),
            context: z.record(z.string(), z.unknown()).optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

export type CrmBatchResponse = z.infer<typeof CrmBatchResponseSchema>;

// --- CRM Engagement ---

export const CrmEngagementSchema = z
  .object({
    id: z.string(),
    type: z.enum(['NOTE', 'CALL', 'EMAIL', 'MEETING', 'TASK']),
    properties: z.record(z.string(), z.unknown()),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    archived: z.boolean().optional(),
  })
  .passthrough();

export type CrmEngagement = z.infer<typeof CrmEngagementSchema>;

// --- CRM Contact List ---

export const CrmContactListSchema = z
  .object({
    listId: z.number(),
    name: z.string(),
    listType: z.string().optional(),
    filters: z.array(z.unknown()).optional(),
    metaData: z
      .object({
        size: z.number(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type CrmContactList = z.infer<typeof CrmContactListSchema>;
