-- AlterTable
ALTER TABLE "Action" ADD COLUMN     "stepConditions" JSONB NOT NULL DEFAULT '[]';
