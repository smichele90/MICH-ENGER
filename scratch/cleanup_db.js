const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'mich-enger', 'mich-enger.db');
try {
    const db = new Database(dbPath);
    const result = db.prepare("DELETE FROM accounts WHERE phone_number IS NULL OR phone_number = ''").run();
    console.log(`Deleted ${result.changes} ghost accounts.`);
} catch (err) {
    console.error('Error cleaning DB:', err.message);
}
