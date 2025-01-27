const nano = require('nano')('http://localhost:5984')
export const db = nano.use('neuroglancer');