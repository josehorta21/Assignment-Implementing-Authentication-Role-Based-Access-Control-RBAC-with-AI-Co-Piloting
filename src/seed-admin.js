import { FileStore } from './store.js';
import { hashPassword, validatePassword, validateUsername } from './auth.js';

const username = process.env.ADMIN_USERNAME || '';
const password = process.env.ADMIN_PASSWORD || '';
const dataFile = process.env.DATA_FILE || '.data/boundarylab.json';
if (!validateUsername(username) || !validatePassword(password) || /^(set_|change_|replace_)/i.test(password)) {
  console.error('Set ADMIN_USERNAME and a unique 12+ character ADMIN_PASSWORD in .env before seeding.');
  process.exitCode = 1;
} else {
  const store = new FileStore(dataFile);
  const existing = await store.findUserByUsername(username);
  if (existing) {
    console.error(`Account "${username}" already exists. Refusing to overwrite or elevate it.`);
    process.exitCode = 1;
  } else {
    const user = await store.createUser({ username, passwordHash: await hashPassword(password), role: 'admin' });
    console.log(`Created admin account: ${user.username} (${user.role}). Password is never printed or saved in plaintext.`);
  }
}
