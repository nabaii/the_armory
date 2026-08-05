import type { Metadata } from "next";
import { LegalDocument } from "@/components/sections/LegalDocument";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "Terms of use and conditions of entry for The Armory Shooting Sports Club.",
};

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms"
      purpose="The conditions on which we provide this website, and the conditions of entry to the club and its ranges."
      requiredContents={[
        "Who we are, and what these terms cover — website use is separate from conditions of entry.",
        "Eligibility: minimum age, and any conditions that would prevent someone shooting.",
        "Conditions of entry to the ranges, including compliance with range officer instruction.",
        "Liability and assumption of risk, and how it is limited. Digital waivers are Phase 2.5, so confirm what is signed in person at launch and by whom.",
        "That all firearms are range-owned, remain on site, and may not be brought in or taken out under any circumstances.",
        "Membership terms: application, acceptance at the club's discretion, renewal, suspension and termination.",
        "That membership prices are quoted on application and are not published.",
        "Booking terms for first visits and groups, cross-referencing the refund and deposit policy.",
        "Photography and consent — whether member or guest images may ever be used, and how consent is obtained. Spec §7 defaults this to no.",
        "Governing law and jurisdiction.",
      ]}
      note="For counsel: the Brief flags an explicit decision that should be settled in this document rather than left to practice — whether member photography is ever public. The stated default is no. If that default holds, the terms should say so plainly, because it is a meaningful reassurance to exactly the audience the club is recruiting."
    />
  );
}
