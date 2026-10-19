/**
 * The mongod binary the dev database and the tests use. 8.2.6 is already in the
 * local cache (~/.cache/mongodb-binaries), so nothing downloads. Override with
 * MONGOMS_VERSION. A replica set is required: transactions need one.
 */
export const MONGO_BINARY_VERSION = process.env.MONGOMS_VERSION ?? '8.2.6';
export const DEV_DB_PORT = Number(process.env.DEV_DB_PORT ?? 27018);
export const DEV_DB_NAME = 'prodevly';
