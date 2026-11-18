import { FileStore } from './store.js';

const store = new FileStore(process.env.DATA_FILE || '.data/boundarylab.json');
const { users } = await store.read();
if (!users.length) console.log('No accounts found. Register a user and seed the admin first.');
else {
  console.log('Password storage inspection (hashes are never plaintext):');
  for (const user of users) {
    const [algorithm, workFactor, salt, derived] = String(user.passwordHash).split('$');
    console.log(`- username=${user.username}; role=${user.role}; algorithm=${algorithm}; iterations=${workFactor}; salt=${salt}; hash=${derived?.slice(0, 12)}...`);
  }
}
