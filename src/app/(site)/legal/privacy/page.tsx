import type { Metadata } from "next";
import { LegalDocument } from "@/components/sections/LegalDocument";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "How The Armory Shooting Sports Club collects, uses and protects personal data.",
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy policy"
      purpose="How we collect, use, store and protect personal data, and what rights you have over it."
      requiredContents={[
        "Identity of the data controller, and a contact route for data protection questions.",
        "Lawful basis for each category of processing — membership applications, first-visit bookings, group enquiries and the Leagues waitlist are four distinct purposes.",
        "What is collected at each point. The website collects no identity documents in Phase 1; identity verification happens in person.",
        "Retention schedule per category, with a defined disposal point. Not 'as long as necessary'.",
        "Who has access. Spec §7 limits personal data to named staff, encrypted at rest and in transit.",
        "Confirmation that no member directory, attendance record or individually attributable schedule is published.",
        "Third parties that process data on our behalf — payment gateway, CRM, transactional email, analytics — and what each receives.",
        "Data subject rights under the Nigeria Data Protection Act, and how to exercise them.",
        "Whether any data leaves Nigeria, and on what basis.",
        "Cookie and analytics disclosure. Analytics is privacy-respecting; no third-party advertising trackers run on pages handling personal data.",
      ]}
      note="For counsel: please confirm whether the club's processing volume and the sensitivity of the data make it a data controller of major importance under the NDPA, which would trigger registration and Data Protection Officer obligations. The Brief is explicit that member data amounts to a list of wealthy Abuja residents together with where they will be and when — this should be treated as elevated risk rather than routine customer data."
    />
  );
}
