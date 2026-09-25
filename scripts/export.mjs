import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
const path = process.env.DATABASE_PATH || './data/waitlist.sqlite';
if (!existsSync(path)) { console.error('No waitlist database found.'); process.exit(1); }
const db = new DatabaseSync(path, { readOnly: true });
const rows = db.prepare('SELECT id,name,email,market,style,created_at,consent_version FROM members ORDER BY id').all();
const columns = ['id', 'name', 'email', 'market', 'style', 'created_at', 'consent_version'];
// Neutralize spreadsheet formula prefixes in user-provided CSV values.
const cell = value => { let text = String(value ?? ''); if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; };
console.log(columns.join(','));
for (const row of rows) console.log(columns.map(key => cell(row[key])).join(','));
db.close();
