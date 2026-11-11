const pool = require('./pool');
async function recordAudit(event, db = pool) {
  const result = await db.query(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, request_id, metadata) VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id, event_timestamp',
    [event.actorUserId || null, event.action, event.entityType, event.entityId == null ? null : String(event.entityId), event.requestId, JSON.stringify(event.metadata || {})]
  );
  return result.rows[0];
}
async function listAuditLogs(db, filters) {
  const values = [];
  const clauses = [];
  if (filters.action) { values.push(filters.action); clauses.push(`action = $${values.length}`); }
  if (filters.userId) { values.push(filters.userId); clauses.push(`actor_user_id = $${values.length}`); }
  if (filters.from) { values.push(filters.from); clauses.push(`event_timestamp >= $${values.length}`); }
  if (filters.to) { values.push(filters.to); clauses.push(`event_timestamp < $${values.length}`); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const count = await db.query(`SELECT COUNT(*)::text AS total FROM audit_logs ${where}`, values);
  values.push(filters.limit, filters.offset);
  const rows = await db.query(
    `SELECT id, actor_user_id, action, entity_type, entity_id, event_timestamp, request_id, metadata FROM audit_logs ${where} ORDER BY event_timestamp DESC, id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return { total: count.rows[0].total, rows: rows.rows };
}
module.exports = { recordAudit, listAuditLogs };
