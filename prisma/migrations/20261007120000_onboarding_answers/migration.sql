-- Answers to the brand questionnaire shown in the library (one row per user).
CREATE TABLE `onboarding_answers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `niche` VARCHAR(255) NULL,
    `product` TEXT NULL,
    `brand` VARCHAR(255) NULL,
    `website` VARCHAR(500) NULL,
    `library_type` VARCHAR(10) NULL,
    `library_url` VARCHAR(1000) NULL,
    `competitors` JSON NULL,
    `completed_at` TIMESTAMP(0) NULL,
    `skipped_at` TIMESTAMP(0) NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `onboarding_answers_user`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `onboarding_answers` ADD CONSTRAINT `fk_onboarding_answers_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
