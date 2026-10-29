-- Initial schema for the Company Income, Project & Financial Management System.
-- Money columns are DECIMAL(18,4). Timestamps are DATETIME(3) stored in UTC.

-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `fullName` VARCHAR(160) NOT NULL,
    `avatarUrl` VARCHAR(512) NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    `locale` VARCHAR(16) NOT NULL DEFAULT 'en-IN',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastLoginAt` DATETIME(3) NULL,
    `resetTokenHash` VARCHAR(128) NULL,
    `resetTokenExpiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `familyId` CHAR(36) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `replacedByTokenHash` CHAR(64) NULL,
    `userAgent` VARCHAR(255) NULL,
    `ipAddress` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_tokenHash_key`(`tokenHash`),
    INDEX `refresh_tokens_userId_idx`(`userId`),
    INDEX `refresh_tokens_familyId_idx`(`familyId`),
    INDEX `refresh_tokens_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `companies` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `legalName` VARCHAR(200) NULL,
    `baseCurrency` CHAR(3) NOT NULL DEFAULT 'INR',
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    `fiscalYearStartMonth` TINYINT NOT NULL DEFAULT 4,
    `logoUrl` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_memberships` (
    `id` CHAR(36) NOT NULL,
    `companyId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `role` ENUM('OWNER', 'ADMIN', 'PARTNER', 'VIEWER') NOT NULL DEFAULT 'PARTNER',
    `status` ENUM('INVITED', 'ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `invitedById` CHAR(36) NULL,
    `invitedAt` DATETIME(3) NULL,
    `joinedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `company_memberships_userId_idx`(`userId`),
    INDEX `company_memberships_companyId_role_idx`(`companyId`, `role`),
    UNIQUE INDEX `company_memberships_companyId_userId_key`(`companyId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `projects` (
    `id` CHAR(36) NOT NULL,
    `companyId` CHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `description` TEXT NULL,
    `type` ENUM('SAAS', 'WEB_APPLICATION', 'MOBILE_APPLICATION', 'CLIENT_WEBSITE', 'CUSTOM_SOFTWARE', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `status` ENUM('PLANNING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `revenueModel` ENUM('MONTHLY_SUBSCRIPTION', 'ANNUAL_SUBSCRIPTION', 'ONE_TIME_PAYMENT', 'IN_APP_PURCHASE', 'ADVERTISING', 'CLIENT_MILESTONE', 'MANUAL_BANK_TRANSFER', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `projectUrl` VARCHAR(512) NULL,
    `repositoryUrl` VARCHAR(512) NULL,
    `launchDate` DATE NULL,
    `notes` TEXT NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `projects_companyId_status_idx`(`companyId`, `status`),
    INDEX `projects_companyId_type_idx`(`companyId`, `type`),
    INDEX `projects_createdById_idx`(`createdById`),
    UNIQUE INDEX `projects_companyId_code_key`(`companyId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_provider_accounts` (
    `id` CHAR(36) NOT NULL,
    `companyId` CHAR(36) NOT NULL,
    `provider` ENUM('STRIPE', 'RAZORPAY', 'GOOGLE_PLAY', 'MANUAL_BANK', 'OTHER') NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `externalAccountId` VARCHAR(191) NULL,
    `apiKeyCiphertext` TEXT NULL,
    `webhookSecretCiphertext` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isVerified` BOOLEAN NOT NULL DEFAULT false,
    `lastWebhookAt` DATETIME(3) NULL,
    `verificationTestedAt` DATETIME(3) NULL,
    `settings` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `payment_provider_accounts_companyId_provider_idx`(`companyId`, `provider`),
    UNIQUE INDEX `payment_provider_accounts_companyId_provider_label_key`(`companyId`, `provider`, `label`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_product_mappings` (
    `id` CHAR(36) NOT NULL,
    `providerAccountId` CHAR(36) NOT NULL,
    `provider` ENUM('STRIPE', 'RAZORPAY', 'GOOGLE_PLAY', 'MANUAL_BANK', 'OTHER') NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `externalProductId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(160) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `provider_product_mappings_projectId_idx`(`projectId`),
    UNIQUE INDEX `provider_product_mappings_providerAccountId_externalProductI_key`(`providerAccountId`, `externalProductId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_events` (
    `id` CHAR(36) NOT NULL,
    `providerAccountId` CHAR(36) NULL,
    `provider` ENUM('STRIPE', 'RAZORPAY', 'GOOGLE_PLAY', 'MANUAL_BANK', 'OTHER') NOT NULL,
    `externalEventId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(120) NOT NULL,
    `signatureValid` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED', 'NEEDS_REVIEW') NOT NULL DEFAULT 'RECEIVED',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `payload` JSON NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,
    `nextRetryAt` DATETIME(3) NULL,

    INDEX `webhook_events_status_nextRetryAt_idx`(`status`, `nextRetryAt`),
    INDEX `webhook_events_providerAccountId_receivedAt_idx`(`providerAccountId`, `receivedAt`),
    UNIQUE INDEX `webhook_events_provider_externalEventId_key`(`provider`, `externalEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscriptions` (
    `id` CHAR(36) NOT NULL,
    `companyId` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NULL,
    `providerAccountId` CHAR(36) NULL,
    `provider` ENUM('STRIPE', 'RAZORPAY', 'GOOGLE_PLAY', 'MANUAL_BANK', 'OTHER') NOT NULL,
    `externalSubscriptionId` VARCHAR(191) NULL,
    `customerReference` VARCHAR(191) NULL,
    `planCode` VARCHAR(120) NULL,
    `amount` DECIMAL(18, 4) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `interval` ENUM('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL', 'CUSTOM') NOT NULL DEFAULT 'MONTHLY',
    `status` ENUM('TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    `startedAt` DATETIME(3) NOT NULL,
    `currentPeriodStart` DATETIME(3) NULL,
    `currentPeriodEnd` DATETIME(3) NULL,
    `canceledAt` DATETIME(3) NULL,
    `endedAt` DATETIME(3) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `subscriptions_companyId_status_idx`(`companyId`, `status`),
    INDEX `subscriptions_projectId_idx`(`projectId`),
    INDEX `subscriptions_providerAccountId_idx`(`providerAccountId`),
    UNIQUE INDEX `subscriptions_provider_externalSubscriptionId_key`(`provider`, `externalSubscriptionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` CHAR(36) NOT NULL,
    `companyId` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NULL,
    `number` VARCHAR(60) NOT NULL,
    `customerReference` VARCHAR(191) NULL,
    `customerName` VARCHAR(191) NULL,
    `amount` DECIMAL(18, 4) NOT NULL,
    `amountPaid` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `currency` CHAR(3) NOT NULL,
    `status` ENUM('DRAFT', 'SENT', 'PAID', 'PARTIALLY_PAID', 'VOID', 'OVERDUE') NOT NULL DEFAULT 'DRAFT',
    `issuedAt` DATETIME(3) NULL,
    `dueAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `invoices_companyId_status_idx`(`companyId`, `status`),
    INDEX `invoices_projectId_idx`(`projectId`),
    UNIQUE INDEX `invoices_companyId_number_key`(`companyId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transactions` (
    `id` CHAR(36) NOT NULL,
    `companyId` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NULL,
    `providerAccountId` CHAR(36) NULL,
    `provider` ENUM('STRIPE', 'RAZORPAY', 'GOOGLE_PLAY', 'MANUAL_BANK', 'OTHER') NOT NULL DEFAULT 'MANUAL_BANK',
    `subscriptionId` CHAR(36) NULL,
    `externalTransactionId` VARCHAR(191) NULL,
    `type` ENUM('ONE_TIME_PAYMENT', 'SUBSCRIPTION_INITIAL', 'SUBSCRIPTION_RENEWAL', 'IN_APP_PURCHASE', 'MILESTONE_PAYMENT', 'MANUAL_ENTRY', 'ADVERTISING_PAYOUT', 'OTHER') NOT NULL DEFAULT 'ONE_TIME_PAYMENT',
    `status` ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'DISPUTED') NOT NULL DEFAULT 'SUCCEEDED',
    `grossAmount` DECIMAL(18, 4) NOT NULL,
    `feeAmount` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `refundedAmount` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `currency` CHAR(3) NOT NULL,
    `exchangeRateToBase` DECIMAL(18, 8) NULL,
    `customerReference` VARCHAR(191) NULL,
    `description` VARCHAR(500) NULL,
    `invoiceId` CHAR(36) NULL,
    `source` ENUM('AUTOMATED', 'MANUAL', 'IMPORTED') NOT NULL DEFAULT 'MANUAL',
    `reviewStatus` ENUM('NOT_REQUIRED', 'NEEDS_REVIEW', 'RESOLVED') NOT NULL DEFAULT 'NOT_REQUIRED',
    `reviewNote` VARCHAR(500) NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `settledAt` DATETIME(3) NULL,
    `createdById` CHAR(36) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `transactions_companyId_occurredAt_idx`(`companyId`, `occurredAt`),
    INDEX `transactions_companyId_status_occurredAt_idx`(`companyId`, `status`, `occurredAt`),
    INDEX `transactions_projectId_occurredAt_idx`(`projectId`, `occurredAt`),
    INDEX `transactions_companyId_reviewStatus_idx`(`companyId`, `reviewStatus`),
    INDEX `transactions_subscriptionId_idx`(`subscriptionId`),
    INDEX `transactions_providerAccountId_idx`(`providerAccountId`),
    INDEX `transactions_invoiceId_idx`(`invoiceId`),
    INDEX `transactions_createdById_idx`(`createdById`),
    UNIQUE INDEX `transactions_provider_externalTransactionId_key`(`provider`, `externalTransactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refunds` (
    `id` CHAR(36) NOT NULL,
    `transactionId` CHAR(36) NOT NULL,
    `provider` ENUM('STRIPE', 'RAZORPAY', 'GOOGLE_PLAY', 'MANUAL_BANK', 'OTHER') NOT NULL,
    `externalRefundId` VARCHAR(191) NULL,
    `amount` DECIMAL(18, 4) NOT NULL,
    `feeRefunded` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `currency` CHAR(3) NOT NULL,
    `status` ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED') NOT NULL DEFAULT 'SUCCEEDED',
    `isPartial` BOOLEAN NOT NULL DEFAULT false,
    `reason` VARCHAR(500) NULL,
    `source` ENUM('AUTOMATED', 'MANUAL', 'IMPORTED') NOT NULL DEFAULT 'MANUAL',
    `occurredAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `refunds_transactionId_idx`(`transactionId`),
    INDEX `refunds_occurredAt_idx`(`occurredAt`),
    INDEX `refunds_createdById_idx`(`createdById`),
    UNIQUE INDEX `refunds_provider_externalRefundId_key`(`provider`, `externalRefundId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expense_categories` (
    `id` CHAR(36) NOT NULL,
    `companyId` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `slug` VARCHAR(120) NOT NULL,
    `color` VARCHAR(16) NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `expense_categories_companyId_isActive_idx`(`companyId`, `isActive`),
    UNIQUE INDEX `expense_categories_companyId_slug_key`(`companyId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expenses` (
    `id` CHAR(36) NOT NULL,
    `companyId` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NULL,
    `categoryId` CHAR(36) NOT NULL,
    `vendor` VARCHAR(160) NOT NULL,
    `description` VARCHAR(500) NULL,
    `amount` DECIMAL(18, 4) NOT NULL,
    `taxAmount` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `currency` CHAR(3) NOT NULL,
    `exchangeRateToBase` DECIMAL(18, 8) NULL,
    `expenseDate` DATE NOT NULL,
    `paymentStatus` ENUM('PENDING', 'PAID', 'OVERDUE', 'CANCELED') NOT NULL DEFAULT 'PAID',
    `paidAt` DATETIME(3) NULL,
    `receiptUrl` VARCHAR(512) NULL,
    `notes` TEXT NULL,
    `excludeFromProfit` BOOLEAN NOT NULL DEFAULT false,
    `isRecurring` BOOLEAN NOT NULL DEFAULT false,
    `recurringInterval` ENUM('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL', 'CUSTOM') NULL,
    `source` ENUM('AUTOMATED', 'MANUAL', 'IMPORTED') NOT NULL DEFAULT 'MANUAL',
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `expenses_companyId_expenseDate_idx`(`companyId`, `expenseDate`),
    INDEX `expenses_companyId_paymentStatus_idx`(`companyId`, `paymentStatus`),
    INDEX `expenses_projectId_expenseDate_idx`(`projectId`, `expenseDate`),
    INDEX `expenses_categoryId_idx`(`categoryId`),
    INDEX `expenses_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `partner_profit_shares` (
    `id` CHAR(36) NOT NULL,
    `companyId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `percentage` DECIMAL(7, 4) NOT NULL,
    `effectiveFrom` DATE NOT NULL,
    `effectiveTo` DATE NULL,
    `note` VARCHAR(500) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `partner_profit_shares_companyId_effectiveFrom_idx`(`companyId`, `effectiveFrom`),
    INDEX `partner_profit_shares_userId_idx`(`userId`),
    INDEX `partner_profit_shares_createdById_idx`(`createdById`),
    UNIQUE INDEX `partner_profit_shares_companyId_userId_effectiveFrom_key`(`companyId`, `userId`, `effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `partner_payouts` (
    `id` CHAR(36) NOT NULL,
    `companyId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `amount` DECIMAL(18, 4) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `payoutDate` DATE NOT NULL,
    `status` ENUM('PENDING', 'PAID', 'CANCELED') NOT NULL DEFAULT 'PAID',
    `method` VARCHAR(80) NULL,
    `reference` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `periodStart` DATE NULL,
    `periodEnd` DATE NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `partner_payouts_companyId_payoutDate_idx`(`companyId`, `payoutDate`),
    INDEX `partner_payouts_userId_payoutDate_idx`(`userId`, `payoutDate`),
    INDEX `partner_payouts_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exchange_rates` (
    `id` CHAR(36) NOT NULL,
    `companyId` CHAR(36) NULL,
    `baseCurrency` CHAR(3) NOT NULL,
    `quoteCurrency` CHAR(3) NOT NULL,
    `rate` DECIMAL(18, 8) NOT NULL,
    `effectiveDate` DATE NOT NULL,
    `source` VARCHAR(60) NOT NULL DEFAULT 'MANUAL',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `exchange_rates_baseCurrency_quoteCurrency_effectiveDate_idx`(`baseCurrency`, `quoteCurrency`, `effectiveDate`),
    UNIQUE INDEX `exchange_rates_companyId_baseCurrency_quoteCurrency_effectiv_key`(`companyId`, `baseCurrency`, `quoteCurrency`, `effectiveDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` CHAR(36) NOT NULL,
    `companyId` CHAR(36) NULL,
    `actorId` CHAR(36) NULL,
    `action` VARCHAR(80) NOT NULL,
    `entityType` VARCHAR(60) NOT NULL,
    `entityId` VARCHAR(64) NULL,
    `summary` VARCHAR(500) NULL,
    `beforeData` JSON NULL,
    `afterData` JSON NULL,
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_companyId_createdAt_idx`(`companyId`, `createdAt`),
    INDEX `audit_logs_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `audit_logs_actorId_createdAt_idx`(`actorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `companyId` CHAR(36) NULL,
    `userId` CHAR(36) NOT NULL,
    `type` ENUM('PAYMENT_RECEIVED', 'PAYMENT_FAILED', 'REFUND_PROCESSED', 'WEBHOOK_NEEDS_REVIEW', 'SUBSCRIPTION_CANCELED', 'PAYOUT_RECORDED', 'MEMBER_INVITED', 'SYSTEM') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` VARCHAR(500) NULL,
    `link` VARCHAR(512) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_userId_readAt_idx`(`userId`, `readAt`),
    INDEX `notifications_companyId_createdAt_idx`(`companyId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_memberships` ADD CONSTRAINT `company_memberships_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_memberships` ADD CONSTRAINT `company_memberships_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_memberships` ADD CONSTRAINT `company_memberships_invitedById_fkey` FOREIGN KEY (`invitedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `projects_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `projects_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_provider_accounts` ADD CONSTRAINT `payment_provider_accounts_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `provider_product_mappings` ADD CONSTRAINT `provider_product_mappings_providerAccountId_fkey` FOREIGN KEY (`providerAccountId`) REFERENCES `payment_provider_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `provider_product_mappings` ADD CONSTRAINT `provider_product_mappings_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_events` ADD CONSTRAINT `webhook_events_providerAccountId_fkey` FOREIGN KEY (`providerAccountId`) REFERENCES `payment_provider_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_providerAccountId_fkey` FOREIGN KEY (`providerAccountId`) REFERENCES `payment_provider_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_providerAccountId_fkey` FOREIGN KEY (`providerAccountId`) REFERENCES `payment_provider_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `subscriptions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_transactionId_fkey` FOREIGN KEY (`transactionId`) REFERENCES `transactions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expense_categories` ADD CONSTRAINT `expense_categories_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `expense_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `partner_profit_shares` ADD CONSTRAINT `partner_profit_shares_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `partner_profit_shares` ADD CONSTRAINT `partner_profit_shares_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `partner_profit_shares` ADD CONSTRAINT `partner_profit_shares_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `partner_payouts` ADD CONSTRAINT `partner_payouts_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `partner_payouts` ADD CONSTRAINT `partner_payouts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `partner_payouts` ADD CONSTRAINT `partner_payouts_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exchange_rates` ADD CONSTRAINT `exchange_rates_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
