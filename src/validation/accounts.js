const { z } = require('zod');
const createAccountSchema = z.object({}).strict();
const accountIdSchema = z.object({ id: z.string().uuid() }).strict();
const accountStatusSchema = z.object({ status: z.enum(['FROZEN', 'CLOSED']) }).strict();
module.exports = { createAccountSchema, accountIdSchema, accountStatusSchema };
