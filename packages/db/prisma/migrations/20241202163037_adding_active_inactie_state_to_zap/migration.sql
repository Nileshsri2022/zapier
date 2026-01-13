/*
  Warnings:

  - Added the required column `isActive` to the `Zap` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Action_zapId_key";

-- AlterTable
ALTER TABLE "Zap" ADD COLUMN     "isActive" BOOLEAN NOT NULL;
