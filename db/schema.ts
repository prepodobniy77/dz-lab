import {sql} from 'drizzle-orm';
import {index,integer,primaryKey,real,sqliteTable,text,uniqueIndex} from 'drizzle-orm/sqlite-core';
export const priceOffers=sqliteTable('price_offers',{key:text('key').primaryKey(),productId:text('product_id').notNull(),store:text('store').notNull(),data:text('data').notNull(),attemptAt:text('attempt_at').notNull(),isSeed:integer('is_seed').notNull().default(0)},table=>[index('price_offers_live').on(table.isSeed).where(sql`is_seed = 0`)]);
export const priceHistory=sqliteTable('price_history',{id:integer('id').primaryKey({autoIncrement:true}),productId:text('product_id').notNull(),store:text('store').notNull(),price:integer('price').notNull(),checkedAt:text('checked_at').notNull()});
export const builds=sqliteTable('builds',{id:text('id').primaryKey(),name:text('name').notNull(),selection:text('selection').notNull(),createdAt:text('created_at').notNull()});
export const sourceHealth=sqliteTable('source_health',{store:text('store').primaryKey(),checkedAt:text('checked_at').notNull(),blockedUntil:text('blocked_until'),error:text('error')});

export const priceFeedImports = sqliteTable('price_feed_imports', {
 id: text('id').primaryKey().notNull(),
 store: text('store').notNull(),
 checkedAt: text('checked_at').notNull(),
 startedAt: text('started_at').notNull(),
 finishedAt: text('finished_at'),
 expected: integer('expected').notNull(),
 parts: integer('parts').notNull(),
 nextPart: integer('next_part').notNull().default(0),
 status: text('status').notNull().default('open'),
 matched: integer('matched').notNull().default(0),
 updated: integer('updated').notNull().default(0),
 pendingReview: integer('pending_review').notNull().default(0),
 fingerprint: text('fingerprint'),
 rowsWritten: integer('rows_written').notNull().default(0),
 bootstrap: integer('bootstrap').notNull().default(0),
 forced: integer('forced').notNull().default(0),
 conflicts: integer('conflicts').notNull().default(0),
 recognized: integer('recognized').notNull().default(0),
}, table => [uniqueIndex('price_feed_active_store').on(table.store).where(sql`status IN ('open','publishing')`)]);
export const priceFeedRows = sqliteTable('price_feed_rows', {
 importId: text('import_id').notNull().references(() => priceFeedImports.id, {onDelete:'cascade'}),
 productId: text('product_id').notNull(),
 data: text('data').notNull(),
 price: real('price').notNull(),
 baselineAt: text('baseline_at').notNull(),
 baselinePrice: real('baseline_price'),
 conflict: integer('conflict').notNull().default(0),
 decision: text('decision'),
}, table => [primaryKey({columns:[table.importId,table.productId]})]);
