-- Rain that arrives with too short a lead is knowledge from the future wearing
-- a forecast's clothes. The parser already refuses it; this states the same
-- rule where nothing can bypass it, because the two catch different mistakes:
-- the parser guards the ingest path, the constraint guards the table against
-- any writer, including a future one and a hand run statement.
--
-- Prisma's schema language cannot express a CHECK, so this migration is hand
-- written. It is created with `migrate dev --create-only` and then applied by
-- `migrate dev` so the SQL actually executes before it ships, rather than
-- being discovered broken on deploy (spec 0010 child, AC-R2).
ALTER TABLE "weather_forecasts"
    ADD CONSTRAINT "weather_forecasts_lead_hours_check" CHECK ("leadHours" >= 24);
