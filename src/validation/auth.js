const { z } = require('zod');
const email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const password = z.string().min(12).max(72).refine((value) => Buffer.byteLength(value, 'utf8') <= 72);
const fullName = z.string().trim().min(2).max(120);
const registrationSchema = z.object({ fullName, email, password }).strict();
const loginSchema = z.object({ email, password: z.string().min(1).max(72) }).strict();
const auditorSchema = z.object({ fullName, email, password }).strict();
module.exports = { registrationSchema, loginSchema, auditorSchema };
