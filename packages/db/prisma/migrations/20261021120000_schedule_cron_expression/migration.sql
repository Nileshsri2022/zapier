-- T8 (docs/ask-matt/triggers/schedule.md M5): custom 5-field cron schedules.
-- Additive only — nullable column; existing rows unaffected.
ALTER TABLE "ScheduledTrigger" ADD COLUMN "cronExpression" TEXT;
