function pdfEscape(value: string) {
  return value.replaceAll(/[()\\]/gu, (character) => `\\${character}`);
}

/**
 * A one-page PDF holding the demo resume text. The resume row keeps its
 * searchable text directly, so this only needs to open as a PDF.
 * @param lines The lines printed on the page.
 * @returns The PDF bytes.
 */
export function minimalPdf(lines: readonly string[]) {
  const content = [
    "BT",
    "/F1 14 Tf",
    "72 720 Td",
    ...lines.flatMap((line, index) =>
      index === 0 ? [`(${pdfEscape(line)}) Tj`] : ["0 -20 Td", `(${pdfEscape(line)}) Tj`],
    ),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];

  for (const [index, object] of objects.entries()) {
    offsets.push(body.length);
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = body.length;

  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;

  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }

  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;

  return new TextEncoder().encode(body);
}
