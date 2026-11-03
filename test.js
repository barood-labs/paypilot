import assert from 'assert'; import { parseRequest } from './server.js';
const p = parseRequest('Lawn mowing 2 hours on Friday for $80'); assert.equal(p.amount, '80.00'); assert.equal(p.hours, 2); assert.equal(p.day, 'friday'); console.log('ok', p);
