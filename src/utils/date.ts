function isDateLike(value: string): boolean {
  return (
    /\d{4}-\d{2}-\d{2}/.test(value) ||
    /\d{2}\/\d{2}\/\d{4}/.test(value)
  );
}

export function formatDateIfValid(value: string): string {
  if (!isDateLike(value)) {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  return `${day}/${month}/${year}`;
}
