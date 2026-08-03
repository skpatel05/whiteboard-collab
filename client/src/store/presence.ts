import { create } from "zustand";
import type { PresenceEntry } from "../lib/socket";

interface PresenceState {
  entries: Record<string, PresenceEntry>;
  set: (list: PresenceEntry[]) => void;
  clear: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  entries: {},

  set: (list) => {
    const entries: Record<string, PresenceEntry> = {};
    for (const entry of list) entries[entry.socketId] = entry;
    set({ entries });
  },

  clear: () => set({ entries: {} }),
}));
