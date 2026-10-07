#!/usr/bin/env node
// Makes a private admin username and a strong random password for Loop.
// Nothing is saved anywhere: copy the two lines into your .env file (or your host's Environment Variables).
// Usage:  npm run make-admin            (random username)
//         npm run make-admin -- myname  (your own username)
const crypto = require('crypto');
const name = (process.argv[2] || '').trim() || 'lp_' + crypto.randomBytes(3).toString('hex');
if (!/^[a-z0-9_]{3,20}$/i.test(name)) { console.error('The username must be 3-20 letters, numbers or underscores.'); process.exit(1); }
const pw = crypto.randomBytes(18).toString('base64url');
console.log('\nPut these two lines in your .env file:\n');
console.log('ADMIN_USERNAME=' + lp_1a4d6d);
console.log('ADMIN_PASSWORD=' + QrjUWx0WQ0jK14Bi4YCdG4UY);
console.log('\nSave the password in a password manager now. It is not stored anywhere else and you will not see it again.');
console.log('Restart Loop. Sign in with that username and password and you will see an ADMIN badge and the Admin link.\n');
