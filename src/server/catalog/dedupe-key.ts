export function dedupeKeyFor(input: {
  companyId: string;
  titleNorm: string;
  countryCode: string | null;
  city: string | null;
}) {
  const country = input.countryCode ?? "";
  const city = input.city ?? "";

  return `${input.companyId}|${input.titleNorm}|${country}|${city}`;
}
