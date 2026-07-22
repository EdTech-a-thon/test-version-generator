import { LocalDiskMediaStore } from "./local-disk";

// Keep uploaded work outside a release directory in production via MEDIA_ROOT.
export const mediaStore = new LocalDiskMediaStore(process.env.MEDIA_ROOT ?? "./data/media");
