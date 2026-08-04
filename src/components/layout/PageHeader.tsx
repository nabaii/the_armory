import { Section, type Ground } from "@/components/layout/Section";
import { CtaPair } from "@/components/ui/Button";
import { H1, Kicker, Lead } from "@/components/ui/Text";

/**
 * Page header. Kicker, title, lead — the opening of every route except Home,
 * which uses the Hero instead.
 *
 * The `ground` prop carries the page's access register (Brand Guidelines §4),
 * so the tiering is established in the first screen without a word of copy:
 * Soffit Blue for open contexts, VIP Teal for member contexts.
 */
export function PageHeader({
  kicker,
  title,
  lead,
  ground = "chalk",
  primary,
  secondary,
}: {
  kicker?: string;
  title: string;
  /** One or two sentences. Plain words, short sentences, no hype. */
  lead?: string;
  ground?: Ground;
  primary?: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <Section ground={ground} rhythm="default">
      {kicker && <Kicker className="mb-3">{kicker}</Kicker>}
      <H1>{title}</H1>
      {lead && (
        <Lead muted className="mt-3">
          {lead}
        </Lead>
      )}
      {primary && secondary && (
        <CtaPair primary={primary} secondary={secondary} className="mt-4" />
      )}
    </Section>
  );
}
