#!/usr/bin/env node
/** Usage: npm run hash -- 'the-admin-password'  →  prints ADMIN_PASSWORD_HASH */
import bcrypt from 'bcryptjs';

const pw = process.argv[2];
if (!pw) { console.error("usage: npm run hash -- 'your-password'"); process.exit(1); }
if (pw.length < 12) console.error('warning: use at least 12 characters — this page is reachable from the public internet.\n');
console.log(bcrypt.hashSync(pw, 12));
