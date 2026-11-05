/**
 * Creates (or resets) the admin login.   Usage:  node setup-admin.js
 * The password is stored only as a salted scrypt hash in data/admin.json.
 */


const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const FILE = path.join(__dirname, 'data', 'admin.json');
fs.mkdirSync(path.dirname(FILE), { recursive: true });

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    }
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  let username = process.env.ADMIN_USER;
  let password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    username = (await ask('Admin username: ')).trim();
    password = await ask('Admin password (min 10 characters): ', true);
    const again = await ask('Repeat password: ', true);
    if (password !== again) { console.error('Passwords do not match.'); process.exit(1); }
  }
  if (!username) { console.error('Username is required.'); process.exit(1); }
  if (password.length < 10) { console.error('Password must be at least 10 characters.'); process.exit(1); }

  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  fs.writeFileSync(FILE, JSON.stringify({ username, salt: salt.toString('hex'), hash: hash.toString('hex') }, null, 2), { mode: 0o600 });
  console.log('Admin account saved. Start the site with:  node server.js');
})();
