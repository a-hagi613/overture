export interface LegalParagraphBlock {
  kind: "paragraph";
  text: string;
}

export interface LegalLinkedParagraphBlock {
  kind: "paragraphWithLink";
  before: string;
  link: string;
  after: string;
  href: string;
}

export interface LegalBulletsBlock {
  kind: "bullets";
  items: readonly string[];
}

export interface LegalProcessorsBlock {
  kind: "processors";
  companyLabel: string;
  doesLabel: string;
  rows: readonly { does: string; name: string }[];
}

export type LegalBlock =
  | LegalParagraphBlock
  | LegalLinkedParagraphBlock
  | LegalBulletsBlock
  | LegalProcessorsBlock;

export interface LegalSection {
  heading: string;
  blocks: readonly LegalBlock[];
}
