var PouchDB = require('pouchdb-node');
export const dbp = new PouchDB('mydb');
export const pouch = new PouchDB('http://localhost:5984/my-db');
