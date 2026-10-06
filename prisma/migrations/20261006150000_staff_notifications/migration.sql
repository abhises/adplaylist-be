-- Notifications under the bell: for staff, admins only, or one user.
CREATE TABLE `notifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `audience` VARCHAR(10) NOT NULL,
    `recipient_id` INTEGER NULL,
    `type` VARCHAR(40) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `body` TEXT NULL,
    `link` VARCHAR(500) NULL,
    `request_id` INTEGER NULL,
    `actor_id` INTEGER NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `notifications_audience_created`(`audience`, `created_at`),
    INDEX `fk_notifications_recipient`(`recipient_id`),
    INDEX `fk_notifications_request`(`request_id`),
    INDEX `fk_notifications_actor`(`actor_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Each person's read status: a row means they've read it.
CREATE TABLE `notification_reads` (
    `notification_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `read_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `fk_notification_reads_user`(`user_id`),
    PRIMARY KEY (`notification_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `notifications` ADD CONSTRAINT `fk_notifications_recipient` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `notifications` ADD CONSTRAINT `fk_notifications_request` FOREIGN KEY (`request_id`) REFERENCES `creative_requests`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `notifications` ADD CONSTRAINT `fk_notifications_actor` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `notification_reads` ADD CONSTRAINT `fk_notification_reads_notification` FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `notification_reads` ADD CONSTRAINT `fk_notification_reads_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
