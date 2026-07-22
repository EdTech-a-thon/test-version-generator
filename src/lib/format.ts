export function questionTypeLabel(type: string) {
  return type
    .toLowerCase()
    .split("_")
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

export function letter(index: number) {
  return String.fromCharCode(65 + index);
}
