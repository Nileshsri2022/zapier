/*
  Warnings:

  - A unique constraint covering the columns `[zapId]` on the table `Action` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Action_zapId_key" ON "Action"("zapId");
