/*
  Warnings:

  - You are about to drop the column `matchWeek` on the `matches` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[externalId]` on the table `matches` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `externalId` to the `matches` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "matches" DROP COLUMN "matchWeek",
ADD COLUMN     "externalId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "matches_externalId_key" ON "matches"("externalId");
