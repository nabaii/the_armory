CREATE SCHEMA "armory";
--> statement-breakpoint
CREATE TYPE "armory"."application_status" AS ENUM('submitted', 'under_review', 'admitted', 'waitlisted', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "armory"."booking_status" AS ENUM('draft', 'confirmed', 'cancelled', 'completed', 'no_show');--> statement-breakpoint
CREATE TYPE "armory"."capture_method" AS ENUM('manual', 'electronic');--> statement-breakpoint
CREATE TYPE "armory"."custody_event_type" AS ENUM('issued', 'returned', 'brought_in', 'taken_out', 'stored', 'withdrawn', 'sent_for_service', 'returned_from_service', 'decommissioned', 'correction');--> statement-breakpoint
CREATE TYPE "armory"."device_surface" AS ENUM('desk', 'lane');--> statement-breakpoint
CREATE TYPE "armory"."firearm_ownership" AS ENUM('club', 'member');--> statement-breakpoint
CREATE TYPE "armory"."firearm_status" AS ENUM('in_service', 'issued', 'off_site', 'in_storage', 'at_service', 'decommissioned');--> statement-breakpoint
CREATE TYPE "armory"."invitation_status" AS ENUM('issued', 'opened', 'completed', 'attended', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "armory"."lane_status" AS ENUM('available', 'maintenance', 'closed');--> statement-breakpoint
CREATE TYPE "armory"."ledger_direction" AS ENUM('credit', 'debit');--> statement-breakpoint
CREATE TYPE "armory"."licence_status" AS ENUM('pending_review', 'verified', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "armory"."membership_status" AS ENUM('pending', 'active', 'lapsed', 'suspended', 'resigned');--> statement-breakpoint
CREATE TYPE "armory"."participant_role" AS ENUM('member_shooter', 'guest_shooter', 'spectator');--> statement-breakpoint
CREATE TYPE "armory"."payment_purpose" AS ENUM('subscription', 'guest_overage', 'account_topup', 'bar', 'retail', 'other');--> statement-breakpoint
CREATE TYPE "armory"."payment_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "armory"."session_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "armory"."sponsor_type" AS ENUM('member', 'club');--> statement-breakpoint
CREATE TYPE "armory"."staff_role" AS ENUM('founder', 'range_officer', 'read_only');--> statement-breakpoint
CREATE TYPE "armory"."waitlist_status" AS ENUM('waiting', 'contacted', 'admitted', 'withdrawn');--> statement-breakpoint
CREATE TABLE "armory"."account_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"direction" "armory"."ledger_direction" NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"balance_kobo" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."ammunition_issues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lot_id" uuid NOT NULL,
	"participation_id" uuid NOT NULL,
	"qty_issued" integer NOT NULL,
	"qty_fired" integer,
	"qty_returned" integer,
	"issued_by_staff_id" uuid,
	"reconciled_at" timestamp with time zone,
	"issued_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" uuid
);
--> statement-breakpoint
CREATE TABLE "armory"."ammunition_lots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"calibre" text NOT NULL,
	"quantity_received" integer NOT NULL,
	"quantity_remaining" integer NOT NULL,
	"supplier" text,
	"received_on" date NOT NULL,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"sponsor_type" "armory"."sponsor_type" NOT NULL,
	"sponsor_membership_id" uuid,
	"requested_tier_id" uuid,
	"status" "armory"."application_status" DEFAULT 'submitted' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by_staff_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"identifier" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"condition" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_staff_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"device_id" uuid,
	"is_override" boolean DEFAULT false NOT NULL,
	"override_reason" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."booking_participants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "armory"."participant_role" NOT NULL,
	"guest_invitation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."bookings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"host_membership_id" uuid NOT NULL,
	"booking_date" date NOT NULL,
	"slot_start" timestamp with time zone NOT NULL,
	"slot_end" timestamp with time zone NOT NULL,
	"discipline" text NOT NULL,
	"status" "armory"."booking_status" DEFAULT 'draft' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."charges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payer_person_id" uuid NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" uuid,
	"line_items" jsonb NOT NULL,
	"total_kobo" bigint NOT NULL,
	"is_settled" boolean DEFAULT false NOT NULL,
	"settled_payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."custody_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firearm_id" uuid NOT NULL,
	"event_type" "armory"."custody_event_type" NOT NULL,
	"actor_staff_id" uuid,
	"counterparty_person_id" uuid,
	"session_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" uuid,
	"corrects_event_id" uuid,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "armory"."devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"surface" "armory"."device_surface" NOT NULL,
	"registered_by_staff_id" uuid,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."firearms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"serial_number" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"calibre" text NOT NULL,
	"discipline" text,
	"ownership" "armory"."firearm_ownership" NOT NULL,
	"owner_person_id" uuid,
	"licence_id" uuid,
	"status" "armory"."firearm_status" DEFAULT 'in_service' NOT NULL,
	"condition" text,
	"round_count" integer DEFAULT 0 NOT NULL,
	"acquired_on" date,
	"decommissioned_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."guest_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"host_membership_id" uuid NOT NULL,
	"guest_person_id" uuid,
	"booking_id" uuid,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "armory"."invitation_status" DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"is_chargeable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."guest_visit_summary" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"visit_count" integer DEFAULT 0 NOT NULL,
	"first_visit_at" timestamp with time zone,
	"last_visit_at" timestamp with time zone,
	"distinct_host_count" integer DEFAULT 0 NOT NULL,
	"converted_membership_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."host_allowances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"membership_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"included_quota" integer DEFAULT 0 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"overage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."incident_persons" (
	"incident_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"involvement" text NOT NULL,
	CONSTRAINT "incident_persons_incident_id_person_id_pk" PRIMARY KEY("incident_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "armory"."incidents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid,
	"category" text NOT NULL,
	"narrative" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"reported_by_staff_id" uuid,
	"follow_up_status" text DEFAULT 'open' NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" uuid
);
--> statement-breakpoint
CREATE TABLE "armory"."lanes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"discipline" text NOT NULL,
	"number" integer NOT NULL,
	"status" "armory"."lane_status" DEFAULT 'available' NOT NULL,
	"position_capacity" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."licences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"licence_number" text NOT NULL,
	"issuing_authority" text NOT NULL,
	"calibres" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"issued_on" date,
	"expires_on" date,
	"document_url" text,
	"status" "armory"."licence_status" DEFAULT 'pending_review' NOT NULL,
	"verified_by_staff_id" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"member_number" integer NOT NULL,
	"status" "armory"."membership_status" DEFAULT 'pending' NOT NULL,
	"is_founding" boolean DEFAULT false NOT NULL,
	"principal_membership_id" uuid,
	"started_on" date,
	"renews_on" date,
	"ended_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."participations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "armory"."participant_role" NOT NULL,
	"host_person_id" uuid,
	"lane_id" uuid,
	"tier_snapshot" jsonb,
	"checked_in_at" timestamp with time zone NOT NULL,
	"checked_in_by_staff_id" uuid,
	"checked_out_at" timestamp with time zone,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" uuid
);
--> statement-breakpoint
CREATE TABLE "armory"."payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"purpose" "armory"."payment_purpose" NOT NULL,
	"method" text,
	"gateway" text,
	"gateway_reference" text,
	"status" "armory"."payment_status" DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."people" (
	"id" uuid PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"date_of_birth" date,
	"photo_url" text,
	"address" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"notes" text,
	"anonymised_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."qualifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"discipline" text NOT NULL,
	"level" text NOT NULL,
	"assessed_by_staff_id" uuid,
	"assessed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"participation_id" uuid NOT NULL,
	"discipline" text NOT NULL,
	"format" text NOT NULL,
	"total_score" integer NOT NULL,
	"shot_detail" jsonb,
	"capture_method" "armory"."capture_method" NOT NULL,
	"source_reference" text,
	"captured_by_staff_id" uuid,
	"captured_at" timestamp with time zone NOT NULL,
	"corrects_round_id" uuid,
	"correction_reason" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" uuid
);
--> statement-breakpoint
CREATE TABLE "armory"."sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid,
	"session_date" date NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_by_staff_id" uuid,
	"closed_at" timestamp with time zone,
	"closed_by_staff_id" uuid,
	"status" "armory"."session_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."staff_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "armory"."staff_role" NOT NULL,
	"pin_hash" text,
	"certifications" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."storage_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firearm_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"cabinet_reference" text NOT NULL,
	"assigned_on" date NOT NULL,
	"released_on" date,
	"fee_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."tiers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"monthly_fee_kobo" bigint,
	"annual_fee_kobo" bigint,
	"can_host" boolean DEFAULT false NOT NULL,
	"guest_allowance_annual" integer DEFAULT 0 NOT NULL,
	"guest_concurrent_max" integer DEFAULT 0 NOT NULL,
	"can_own_firearm" boolean DEFAULT false NOT NULL,
	"can_store_firearm" boolean DEFAULT false NOT NULL,
	"discipline_access" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"booking_horizon_days" integer DEFAULT 14 NOT NULL,
	"concurrent_bookings_max" integer DEFAULT 1 NOT NULL,
	"is_attachable" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."waitlist_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_contacted_at" timestamp with time zone,
	"status" "armory"."waitlist_status" DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."waiver_signatures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"waiver_version_id" uuid NOT NULL,
	"signature_image_url" text,
	"signed_at" timestamp with time zone NOT NULL,
	"device_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."waiver_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"body" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."write_receipts" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"operation" text NOT NULL,
	"result" jsonb,
	"device_id" uuid,
	"actor_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "armory"."account_transactions" ADD CONSTRAINT "account_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "armory"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."accounts" ADD CONSTRAINT "accounts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "armory"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."ammunition_issues" ADD CONSTRAINT "ammunition_issues_lot_id_ammunition_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "armory"."ammunition_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."ammunition_issues" ADD CONSTRAINT "ammunition_issues_participation_id_participations_id_fk" FOREIGN KEY ("participation_id") REFERENCES "armory"."participations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."ammunition_issues" ADD CONSTRAINT "ammunition_issues_issued_by_staff_id_staff_users_id_fk" FOREIGN KEY ("issued_by_staff_id") REFERENCES "armory"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."ammunition_issues" ADD CONSTRAINT "ammunition_issues_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "armory"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."applications" ADD CONSTRAINT "applications_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "armory"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."applications" ADD CONSTRAINT "applications_sponsor_membership_id_memberships_id_fk" FOREIGN KEY ("sponsor_membership_id") REFERENCES "armory"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."applications" ADD CONSTRAINT "applications_requested_tier_id_tiers_id_fk" FOREIGN KEY ("requested_tier_id") REFERENCES "armory"."tiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."audit_log" ADD CONSTRAINT "audit_log_actor_staff_id_staff_users_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "armory"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."audit_log" ADD CONSTRAINT "audit_log_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "armory"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."booking_participants" ADD CONSTRAINT "booking_participants_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "armory"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."booking_participants" ADD CONSTRAINT "booking_participants_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "armory"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."booking_participants" ADD CONSTRAINT "booking_participants_guest_invitation_id_guest_invitations_id_fk" FOREIGN KEY ("guest_invitation_id") REFERENCES "armory"."guest_invitations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."bookings" ADD CONSTRAINT "bookings_host_membership_id_memberships_id_fk" FOREIGN KEY ("host_membership_id") REFERENCES "armory"."memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."charges" ADD CONSTRAINT "charges_payer_person_id_people_id_fk" FOREIGN KEY ("payer_person_id") REFERENCES "armory"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."custody_events" ADD CONSTRAINT "custody_events_firearm_id_firearms_id_fk" FOREIGN KEY ("firearm_id") REFERENCES "armory"."firearms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."custody_events" ADD CONSTRAINT "custody_events_actor_staff_id_staff_users_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "armory"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."custody_events" ADD CONSTRAINT "custody_events_counterparty_person_id_people_id_fk" FOREIGN KEY ("counterparty_person_id") REFERENCES "armory"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."custody_events" ADD CONSTRAINT "custody_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "armory"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."custody_events" ADD CONSTRAINT "custody_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "armory"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."devices" ADD CONSTRAINT "devices_registered_by_staff_id_staff_users_id_fk" FOREIGN KEY ("registered_by_staff_id") REFERENCES "armory"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."firearms" ADD CONSTRAINT "firearms_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "armory"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."firearms" ADD CONSTRAINT "firearms_licence_id_licences_id_fk" FOREIGN KEY ("licence_id") REFERENCES "armory"."licences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."guest_invitations" ADD CONSTRAINT "guest_invitations_host_membership_id_memberships_id_fk" FOREIGN KEY ("host_membership_id") REFERENCES "armory"."memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."guest_invitations" ADD CONSTRAINT "guest_invitations_guest_person_id_people_id_fk" FOREIGN KEY ("guest_person_id") REFERENCES "armory"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."guest_visit_summary" ADD CONSTRAINT "guest_visit_summary_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "armory"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."guest_visit_summary" ADD CONSTRAINT "guest_visit_summary_converted_membership_id_memberships_id_fk" FOREIGN KEY ("converted_membership_id") REFERENCES "armory"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."host_allowances" ADD CONSTRAINT "host_allowances_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "armory"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."incident_persons" ADD CONSTRAINT "incident_persons_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "armory"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."incident_persons" ADD CONSTRAINT "incident_persons_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "armory"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."incidents" ADD CONSTRAINT "incidents_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "armory"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."incidents" ADD CONSTRAINT "incidents_reported_by_staff_id_staff_users_id_fk" FOREIGN KEY ("reported_by_staff_id") REFERENCES "armory"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."incidents" ADD CONSTRAINT "incidents_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "armory"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."licences" ADD CONSTRAINT "licences_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "armory"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."memberships" ADD CONSTRAINT "memberships_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "armory"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."memberships" ADD CONSTRAINT "memberships_tier_id_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "armory"."tiers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."participations" ADD CONSTRAINT "participations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "armory"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."participations" ADD CONSTRAINT "participations_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "armory"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."participations" ADD CONSTRAINT "participations_host_person_id_people_id_fk" FOREIGN KEY ("host_person_id") REFERENCES "armory"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."participations" ADD CONSTRAINT "participations_lane_id_lanes_id_fk" FOREIGN KEY ("lane_id") REFERENCES "armory"."lanes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."participations" ADD CONSTRAINT "participations_checked_in_by_staff_id_staff_users_id_fk" FOREIGN KEY ("checked_in_by_staff_id") REFERENCES "armory"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."participations" ADD CONSTRAINT "participations_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "armory"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."payments" ADD CONSTRAINT "payments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "armory"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."qualifications" ADD CONSTRAINT "qualifications_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "armory"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."rounds" ADD CONSTRAINT "rounds_participation_id_participations_id_fk" FOREIGN KEY ("participation_id") REFERENCES "armory"."participations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."rounds" ADD CONSTRAINT "rounds_captured_by_staff_id_staff_users_id_fk" FOREIGN KEY ("captured_by_staff_id") REFERENCES "armory"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."rounds" ADD CONSTRAINT "rounds_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "armory"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."sessions" ADD CONSTRAINT "sessions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "armory"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."sessions" ADD CONSTRAINT "sessions_opened_by_staff_id_staff_users_id_fk" FOREIGN KEY ("opened_by_staff_id") REFERENCES "armory"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."sessions" ADD CONSTRAINT "sessions_closed_by_staff_id_staff_users_id_fk" FOREIGN KEY ("closed_by_staff_id") REFERENCES "armory"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."staff_users" ADD CONSTRAINT "staff_users_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "armory"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."storage_assignments" ADD CONSTRAINT "storage_assignments_firearm_id_firearms_id_fk" FOREIGN KEY ("firearm_id") REFERENCES "armory"."firearms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."storage_assignments" ADD CONSTRAINT "storage_assignments_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "armory"."memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."waitlist_entries" ADD CONSTRAINT "waitlist_entries_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "armory"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."waiver_signatures" ADD CONSTRAINT "waiver_signatures_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "armory"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."waiver_signatures" ADD CONSTRAINT "waiver_signatures_waiver_version_id_waiver_versions_id_fk" FOREIGN KEY ("waiver_version_id") REFERENCES "armory"."waiver_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."write_receipts" ADD CONSTRAINT "write_receipts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "armory"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "armory"."write_receipts" ADD CONSTRAINT "write_receipts_actor_staff_id_staff_users_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "armory"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_transactions_account_idx" ON "armory"."account_transactions" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_person_key" ON "armory"."accounts" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "ammunition_issues_participation_idx" ON "armory"."ammunition_issues" USING btree ("participation_id");--> statement-breakpoint
CREATE INDEX "ammunition_issues_lot_idx" ON "armory"."ammunition_issues" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "ammunition_lots_calibre_idx" ON "armory"."ammunition_lots" USING btree ("calibre");--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "armory"."applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "applications_person_idx" ON "armory"."applications" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_identifier_key" ON "armory"."assets" USING btree ("category","identifier");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "armory"."audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_occurred_idx" ON "armory"."audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_override_idx" ON "armory"."audit_log" USING btree ("is_override");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_participants_key" ON "armory"."booking_participants" USING btree ("booking_id","person_id");--> statement-breakpoint
CREATE INDEX "booking_participants_person_idx" ON "armory"."booking_participants" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "bookings_date_idx" ON "armory"."bookings" USING btree ("booking_date");--> statement-breakpoint
CREATE INDEX "bookings_host_idx" ON "armory"."bookings" USING btree ("host_membership_id");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "armory"."bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "charges_payer_idx" ON "armory"."charges" USING btree ("payer_person_id");--> statement-breakpoint
CREATE INDEX "charges_reference_idx" ON "armory"."charges" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "charges_settled_idx" ON "armory"."charges" USING btree ("is_settled");--> statement-breakpoint
CREATE INDEX "custody_events_firearm_idx" ON "armory"."custody_events" USING btree ("firearm_id","occurred_at");--> statement-breakpoint
CREATE INDEX "custody_events_session_idx" ON "armory"."custody_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "custody_events_corrects_idx" ON "armory"."custody_events" USING btree ("corrects_event_id");--> statement-breakpoint
CREATE INDEX "devices_surface_idx" ON "armory"."devices" USING btree ("surface");--> statement-breakpoint
CREATE UNIQUE INDEX "firearms_serial_key" ON "armory"."firearms" USING btree ("serial_number");--> statement-breakpoint
CREATE INDEX "firearms_owner_idx" ON "armory"."firearms" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "firearms_status_idx" ON "armory"."firearms" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_invitations_token_key" ON "armory"."guest_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "guest_invitations_host_idx" ON "armory"."guest_invitations" USING btree ("host_membership_id");--> statement-breakpoint
CREATE INDEX "guest_invitations_booking_idx" ON "armory"."guest_invitations" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "guest_invitations_status_idx" ON "armory"."guest_invitations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "guest_visit_summary_count_idx" ON "armory"."guest_visit_summary" USING btree ("visit_count");--> statement-breakpoint
CREATE UNIQUE INDEX "host_allowances_period_key" ON "armory"."host_allowances" USING btree ("membership_id","period_start");--> statement-breakpoint
CREATE INDEX "host_allowances_membership_idx" ON "armory"."host_allowances" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "incidents_session_idx" ON "armory"."incidents" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lanes_discipline_number_key" ON "armory"."lanes" USING btree ("discipline","number");--> statement-breakpoint
CREATE INDEX "licences_person_idx" ON "armory"."licences" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "licences_expiry_idx" ON "armory"."licences" USING btree ("expires_on");--> statement-breakpoint
CREATE UNIQUE INDEX "licences_number_key" ON "armory"."licences" USING btree ("licence_number");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_member_number_key" ON "armory"."memberships" USING btree ("member_number");--> statement-breakpoint
CREATE INDEX "memberships_person_idx" ON "armory"."memberships" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "memberships_status_idx" ON "armory"."memberships" USING btree ("status");--> statement-breakpoint
CREATE INDEX "memberships_principal_idx" ON "armory"."memberships" USING btree ("principal_membership_id");--> statement-breakpoint
CREATE INDEX "participations_session_idx" ON "armory"."participations" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "participations_person_idx" ON "armory"."participations" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "participations_host_idx" ON "armory"."participations" USING btree ("host_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_gateway_reference_key" ON "armory"."payments" USING btree ("gateway_reference");--> statement-breakpoint
CREATE INDEX "payments_person_idx" ON "armory"."payments" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_phone_key" ON "armory"."people" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "people_last_name_idx" ON "armory"."people" USING btree ("last_name");--> statement-breakpoint
CREATE INDEX "qualifications_person_idx" ON "armory"."qualifications" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "qualifications_expiry_idx" ON "armory"."qualifications" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "rounds_participation_idx" ON "armory"."rounds" USING btree ("participation_id");--> statement-breakpoint
CREATE INDEX "rounds_corrects_idx" ON "armory"."rounds" USING btree ("corrects_round_id");--> statement-breakpoint
CREATE INDEX "sessions_date_idx" ON "armory"."sessions" USING btree ("session_date");--> statement-breakpoint
CREATE INDEX "sessions_status_idx" ON "armory"."sessions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_users_person_key" ON "armory"."staff_users" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "staff_users_role_idx" ON "armory"."staff_users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "storage_assignments_firearm_idx" ON "armory"."storage_assignments" USING btree ("firearm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tiers_name_key" ON "armory"."tiers" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_application_key" ON "armory"."waitlist_entries" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "waitlist_position_idx" ON "armory"."waitlist_entries" USING btree ("position");--> statement-breakpoint
CREATE INDEX "waiver_signatures_person_idx" ON "armory"."waiver_signatures" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "waiver_signatures_version_idx" ON "armory"."waiver_signatures" USING btree ("waiver_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waiver_versions_version_key" ON "armory"."waiver_versions" USING btree ("version");--> statement-breakpoint
CREATE INDEX "write_receipts_created_idx" ON "armory"."write_receipts" USING btree ("created_at");