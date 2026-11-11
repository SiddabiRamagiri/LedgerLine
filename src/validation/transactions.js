const { z } = require('zod');
const accountIdSchema = z.object({ id: z.string().uuid().transform((value) => value.toLowerCase()) }).strict();
const transactionBodySchema = z.object({ amount_paise: z.number().int().min(1).max(100_000_000) }).strict();
const transferBodySchema = z.object({ destination_account_id: z.string().uuid().transform((value) => value.toLowerCase()), amount_paise: z.number().int().min(1).max(100_000_000) }).strict();
const idempotencyKeySchema = z.string().min(8).max(255).regex(/^[\x21-\x7E]+$/);
const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
}).strict();
module.exports = { accountIdSchema, transactionBodySchema, transferBodySchema, idempotencyKeySchema, historyQuerySchema };

