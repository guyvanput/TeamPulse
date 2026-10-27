import { z } from "zod";

const title = z.string().trim().min(1, "A title is required.").max(160, "Use at most 160 characters.");
const id = z.string().min(1, "An identifier is required.").max(100);
const date = z.string().refine((value) => {
  if (value === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (value.startsWith("0000-")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Enter a valid calendar date (YYYY-MM-DD).");

export const sessionInput = z.object({ teamId: id, title });
export const actionInput = z.object({
  sessionId: id,
  title,
  context: z.string().trim().max(4000, "Use at most 4000 characters."),
  ownerId: id,
  dueDate: date
});
export const reviewInput = z.object({
  sessionId: id,
  actionId: id,
  note: z.string().trim().min(1, "A progress note is required.").max(4000, "Use at most 4000 characters."),
  status: z.enum(["OPEN", "IN_PROGRESS", "DONE"], { error: "Choose a valid status." })
});

export const statusLabels = { OPEN: "Open", IN_PROGRESS: "In progress", DONE: "Done" } as const;

export function isEarlier(source: { createdAt: Date; id: string }, target: { createdAt: Date; id: string }) {
  return source.createdAt < target.createdAt ||
    (source.createdAt.getTime() === target.createdAt.getTime() && source.id < target.id);
}
