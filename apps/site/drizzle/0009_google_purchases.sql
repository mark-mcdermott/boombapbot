ALTER TABLE "licenses" ADD COLUMN "google_purchase_token" text;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_google_purchase_token_unique" UNIQUE("google_purchase_token");