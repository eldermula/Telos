-- 011_add_real_order_notification_type.sql
-- Option 2 Increment E.3 — unconditional real-money movement alerts
-- (place / fail / close). Preference defaults on; E.5+ also uses
-- forceNotifyUser so a user preference cannot silence a real-money event.
ALTER TYPE notification_type ADD VALUE 'real_order';
