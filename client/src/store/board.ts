import { create } from "zustand";
import api from "../lib/api";
import type { BoardDocument, BoardDetail, BoardSummary, Note } from "../types";

interface BoardState {
  boards: BoardSummary[];
  loadingBoards: boolean;
  activeBoard: BoardDetail | null;
  notes: Note[];
  document: BoardDocument | null;
  documentLoaded: boolean;
  fetchBoards: (params?: { workspace?: string; search?: string; starred?: boolean; sort?: string }) => Promise<void>;
  createBoard: (workspaceId: string, title: string) => Promise<BoardSummary>;
  fetchBoard: (boardId: string) => Promise<{ board: BoardDetail; notes: Note[]; document: BoardDocument }>;
  toggleStar: (boardId: string) => Promise<void>;
  touchBoard: (boardId: string) => Promise<void>;
  clearActive: () => void;
}

export const useBoardStore = create<BoardState>((set, get) => ({
  boards: [],
  loadingBoards: false,
  activeBoard: null,
  notes: [],
  document: null,
  documentLoaded: false,

  fetchBoards: async (params) => {
    set({ loadingBoards: true });
    try {
      const query = new URLSearchParams();
      if (params?.workspace) query.set("workspace", params.workspace);
      if (params?.search) query.set("search", params.search);
      if (params?.starred) query.set("starred", "true");
      if (params?.sort) query.set("sort", params.sort);
      const qs = query.toString();
      const res = await api.get<{ data: { boards: BoardSummary[] } }>(`/boards${qs ? `?${qs}` : ""}`);
      set({ boards: res.data.data.boards });
    } finally {
      set({ loadingBoards: false });
    }
  },

  createBoard: async (workspaceId, title) => {
    const res = await api.post<{ data: { board: BoardSummary } }>("/boards", { workspaceId, title });
    return res.data.data.board;
  },

  fetchBoard: async (boardId) => {
    const res = await api.get<{ data: { board: BoardDetail; notes: Note[]; document: BoardDocument } }>(
      `/boards/${boardId}`,
    );
    const { board, notes, document } = res.data.data;
    set({ activeBoard: board, notes, document, documentLoaded: true });
    return { board, notes, document };
  },

  toggleStar: async (boardId) => {
    const current = get().boards.find((b) => b.id === boardId);
    const wasStarred = current?.starred ?? false;
    set({
      boards: get().boards.map((b) => (b.id === boardId ? { ...b, starred: !wasStarred } : b)),
    });
    if (wasStarred) {
      await api.delete(`/boards/${boardId}/star`);
    } else {
      await api.post(`/boards/${boardId}/star`);
    }
  },

  touchBoard: async (boardId) => {
    await api.post(`/boards/${boardId}/touch`);
  },

  clearActive: () => {
    set({ activeBoard: null, notes: [], document: null, documentLoaded: false });
  },
}));
