"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/actor";
import { createAction, createSession, reviewAction, UserError } from "@/lib/service";

export type FormState = { error?: string; success?: string };

function fields(form: FormData) {
  return Object.fromEntries(form.entries());
}

function failure(error: unknown): FormState {
  if (error instanceof UserError) return { error: error.message };
  console.error("TeamPulse mutation failed unexpectedly.");
  return { error: "The change could not be saved. Please try again." };
}

export async function addSession(_state: FormState, form: FormData): Promise<FormState> {
  const actor = await requireActor();
  let id: string;
  try {
    const session = await createSession(actor, fields(form));
    id = session.id;
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/");
  redirect(`/sessions/${id}`);
}

export async function addAction(_state: FormState, form: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    const action = await createAction(actor, fields(form));
    revalidatePath(`/sessions/${action.sourceSessionId}`);
    return { success: "Action captured." };
  } catch (error) {
    return failure(error);
  }
}

export async function addReview(_state: FormState, form: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    const review = await reviewAction(actor, fields(form));
    revalidatePath(`/sessions/${review.reviewSessionId}`);
    revalidatePath(`/actions/${review.actionId}`);
    return { success: "Review recorded." };
  } catch (error) {
    return failure(error);
  }
}
