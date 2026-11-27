ALTER TABLE "licenses" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "licenses" ALTER COLUMN "stripe_session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "licenses" ADD COLUMN "apple_transaction_id" text;--> statement-breakpoint
ALTER TABLE "licenses" ADD COLUMN "sandbox" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_apple_transaction_id_unique" UNIQUE("apple_transaction_id");