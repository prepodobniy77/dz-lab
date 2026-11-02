import {test} from 'node:test';import assert from 'node:assert/strict';
import {minSweepIntervalMinutes,aiProductLimit} from '../lib/price-update-policy.ts';
import {SweepIntervalError,sweepErrorStatus} from '../lib/price-job-errors.ts';
test('защитный интервал настраивается и по умолчанию равен одиннадцати часам',()=>{for(const v of [undefined,'',0,-1,'abc'])assert.equal(minSweepIntervalMinutes(v),660);assert.equal(minSweepIntervalMinutes('720'),720);assert.equal(sweepErrorStatus(new SweepIntervalError(12.2)),429);assert.equal(new SweepIntervalError(12.2).retryAfter,13);assert.equal(sweepErrorStatus(new Error()),503)});
test('платный лимит не превышает действующий предел 50 товаров',()=>{assert.equal(aiProductLimit(1000),50);assert.equal(aiProductLimit(20),20);assert.equal(aiProductLimit(undefined),50)});
