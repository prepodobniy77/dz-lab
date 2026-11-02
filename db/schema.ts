import {integer,sqliteTable,text} from 'drizzle-orm/sqlite-core';
export const priceOffers=sqliteTable('price_offers',{key:text('key').primaryKey(),productId:text('product_id').notNull(),store:text('store').notNull(),data:text('data').notNull(),attemptAt:text('attempt_at').notNull()});
export const priceHistory=sqliteTable('price_history',{id:integer('id').primaryKey({autoIncrement:true}),productId:text('product_id').notNull(),store:text('store').notNull(),price:integer('price').notNull(),checkedAt:text('checked_at').notNull()});
export const builds=sqliteTable('builds',{id:text('id').primaryKey(),name:text('name').notNull(),selection:text('selection').notNull(),createdAt:text('created_at').notNull()});
export const sourceHealth=sqliteTable('source_health',{store:text('store').primaryKey(),checkedAt:text('checked_at').notNull(),blockedUntil:text('blocked_until'),error:text('error')});
