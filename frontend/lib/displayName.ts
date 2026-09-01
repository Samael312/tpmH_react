interface NamedTeacher {
  name?: string | null;
  surname?: string | null;
  user_username?: string | null;
}

export function displayName(t: NamedTeacher | null | undefined): string {
  const full = `${t?.name ?? ""} ${t?.surname ?? ""}`.trim();
  return full || t?.user_username?.replace(/[_.]/g, " ") || "Profesor";
}
