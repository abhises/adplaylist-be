-- Sign-in tokens carry this; raising it revokes every existing token.
ALTER TABLE `users` ADD COLUMN `token_version` INTEGER NOT NULL DEFAULT 0;
