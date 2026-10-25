import { useCallback } from "react";
import { uploadFile } from "../services/base44/uploads";

/**
 * Your photo goes straight to Base44 file storage; the url it hands back is
 * what rides the identity (presence, members, cursors) and, once joined,
 * the user row. Live only — the mock page keeps a data url instead.
 */
export function useAvatarUpload() {
  return useCallback(async (photo: Blob) => {
    const url = await uploadFile(photo, "avatar.jpg");
    if (!url) throw new Error("no url for upload");
    return url;
  }, []);
}
