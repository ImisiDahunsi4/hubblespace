/**
 * File uploads — the Base44 replacement for Convex's generateUploadUrl +
 * POST-to-storage dance. One call; returns a hosted URL that goes straight
 * into a widget's `data` or a member's avatar field.
 */
import { base44 } from "./client";

export async function uploadFile(file: File | Blob, fileName?: string): Promise<string> {
  const f =
    file instanceof File ? file : new File([file], fileName ?? "upload.bin");
  const res = await base44.integrations.Core.UploadFile({ file: f });
  const url = (res as any)?.file_url ?? (res as any)?.url;
  if (!url) throw new Error("upload failed: no url returned");
  return url as string;
}
