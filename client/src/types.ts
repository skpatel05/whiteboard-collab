export interface User {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  avatarColor: string;
}

export type WorkspaceRole = "owner" | "editor" | "viewer";

export interface Workspace {
  id: string;
  name: string;
  description: string;
  owner: string;
  myRole: "owner" | "member";
  memberCount: number;
  createdAt: string;
}

export interface BoardSummary {
  id: string;
  title: string;
  description: string;
  workspace: string;
  createdBy: string;
  starred: boolean;
  lastOpenedAt: string | null;
  currentVersion: number;
  shareLink: { token: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface BoardDocPayload {
  version: number;
  baseVersion: number;
  clientId: number;
  user: string;
  payload: string;
}

export interface BoardDocument {
  snapshotVersion: number;
  snapshot: string | null;
  ops: BoardDocPayload[];
}

export interface Note {
  id: string;
  board: string;
  kind: "sticky" | "minutes";
  author: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface BoardDetail {
  id: string;
  title: string;
  description: string;
  workspace: string;
  createdBy: string;
  starred: boolean;
  myRole: WorkspaceRole;
  lastOpenedAt: string | null;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}
