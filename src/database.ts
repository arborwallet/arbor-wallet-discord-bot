import dotenv from 'dotenv';
import { createPool } from 'mysql2';

dotenv.config();

const database = createPool({
    user: process.env.DATABASE_USER ?? 'root',
    password: process.env.DATABASE_PASS ?? '',
    host: process.env.DATABASE_HOST ?? 'localhost',
    database: process.env.DATABASE_NAME ?? 'arborbot',
    supportBigNumbers: true,
    bigNumberStrings: true,
}).promise();

export default database;
