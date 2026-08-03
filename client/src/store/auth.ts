import { create } from "zustand";
import api, { setAccessToken } from "../lib/api";
import { whiteboardSocket } from "../lib/socket";
import type { User } from "../types";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  initializing: boolean;
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  setSession: (user: User, token: string) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  initializing: true,

  initialize: async () => {
    try {
      const res = await api.post<{ data: { accessToken: string; user: User } }>("/auth/refresh");
      const { accessToken, user } = res.data.data;
      setAccessToken(accessToken);
      set({ user, accessToken, initializing: false });
      whiteboardSocket.reconnect(accessToken);
    } catch {
      set({ user: null, accessToken: null, initializing: false });
    }
  },

  login: async (email, password) => {
    const res = await api.post<{ data: { accessToken: string; user: User } }>("/auth/login", { email, password });
    const { accessToken, user } = res.data.data;
    setAccessToken(accessToken);
    set({ user, accessToken });
    whiteboardSocket.reconnect(accessToken);
  },

  register: async (name, email, password) => {
    await api.post("/auth/register", { name, email, password });
  },

  verifyEmail: async (token) => {
    await api.get("/auth/verify-email", { params: { token } });
  },

  logout: async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      whiteboardSocket.disconnect();
      setAccessToken(null);
      set({ user: null, accessToken: null });
    }
  },

  setSession: (user, token) => {
    setAccessToken(token);
    set({ user, accessToken: token });
  },

  clearSession: () => {
    whiteboardSocket.disconnect();
    setAccessToken(null);
    set({ user: null, accessToken: null });
  },
}));

// Keep the socket auth in sync when the access token rotates mid-session.
window.addEventListener("auth:expired", () => {
  useAuthStore.getState().clearSession();
});
