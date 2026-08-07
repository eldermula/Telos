-- 010_add_real_order_decision_types.sql
-- Option 2 Increment E.3 — decision_log types for real-order lifecycle.
-- ADD VALUE only (same constraint as 003/009): cannot use a freshly
-- added enum value inside the same transaction that added it.
ALTER TYPE decision_type ADD VALUE 'real_order_placed';
ALTER TYPE decision_type ADD VALUE 'real_order_failed';
ALTER TYPE decision_type ADD VALUE 'real_order_closed';
