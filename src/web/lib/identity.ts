export function initialsOf(name: string) {
  const parts = name
    .split(/\s+/u)
    .filter((part) => part.length > 0)
    .slice(0, 2);

  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

export function firstNameOf(name: string) {
  const [first] = name.trim().split(/\s+/u);

  return first === undefined || first === "" ? name : first;
}
