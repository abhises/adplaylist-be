-- AlterTable: "All markets" (11 chars) didn't fit the old VARCHAR(10).
ALTER TABLE `ads` MODIFY `market` VARCHAR(50) NOT NULL;
