import { z } from 'zod';

const dimensionsSchema = z.object({
  width: z.number().positive().nullable(),
  height: z.number().positive().nullable(),
  depth: z.number().positive().nullable(),
}).nullable();

const sketchHintsSchema = z.object({
  cabinetType: z.string().trim().nullable(),
  doorStyle: z.string().trim().nullable(),
  doorCount: z.number().int().positive().nullable(),
  sectionCount: z.number().int().positive().nullable(),
  sectionWidth: z.number().positive().nullable(),
  notes: z.array(z.string().trim().min(1)).default([]),
}).nullable();

export const chatIntentSchema = z.object({
  intent: z.enum([
    'product_enquiry',
    'cart_add',
    'cart_update',
    'cart_remove',
    'cart_view',
    'order_summary',
    'order_submit',
    'conversation',
    'unrelated',
    'unclear',
  ]),
  requestMode: z.enum([
    'fresh_search',
    'continue_previous_selection',
  ]).default('fresh_search'),
  decisionAction: z.enum([
    'add',
    'skip',
    'change_qty',
    'choose_option',
    'ask_more',
    'clear_cart',
    'confirm_clear_cart',
    'start_new_order',
    'prepare_order_summary',
    'confirm_order_summary',
    'edit_order_summary',
    'submit_order',
    'none',
  ]).default('none'),
  referencedItems: z.array(z.number().int().positive()).max(25).default([]),
  removeReferencedItems: z.array(z.number().int().positive()).max(25).default([]),
  clearCartConfirmed: z.boolean().default(false),
  items: z.array(z.object({
    rawReference: z.string().trim().min(1),
    skuCandidate: z.string().trim().nullable(),
    quantity: z.number().int().positive().max(1000).nullable(),
    unit: z.string().trim().nullable(),
    description: z.string().trim().nullable(),
    dimensions: dimensionsSchema,
    sketchHints: sketchHintsSchema,
  })).max(25).default([]),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().trim().nullable(),
});
