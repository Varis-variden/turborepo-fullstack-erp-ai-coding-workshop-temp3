-- The GR sequence row exists from the start, so the first two concurrent confirmations both take
-- the row lock in an UPDATE instead of racing to INSERT it.
INSERT INTO "DocumentSequence" ("type", "lastValue") VALUES ('GR', 0) ON CONFLICT ("type") DO NOTHING;
