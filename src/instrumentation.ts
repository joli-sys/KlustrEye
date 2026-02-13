export async function register() {
  const { ensureDatabase } = await import("@/lib/prisma");
  await ensureDatabase();
}
