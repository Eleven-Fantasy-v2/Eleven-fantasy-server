/*
  Warnings:

  - You are about to drop the column `matchWeek` on the `contests` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[matchweek]` on the table `contests` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `matchweek` to the `contests` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "contests_matchWeek_key";

-- AlterTable
ALTER TABLE "contests" DROP COLUMN "matchWeek",
ADD COLUMN     "matchweek" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "contests_matchweek_key" ON "contests"("matchweek");
