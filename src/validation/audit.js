const { z } = require('zod');
const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().trim().min(1).max(80).optional(),
  user_id: z.coerce.bigint().positive().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional()
}).strict().refine((v) => !v.from || !v.to || Date.parse(v.from) < Date.parse(v.to), { message: 'Invalid date range' });
module.exports = { auditQuerySchema };
