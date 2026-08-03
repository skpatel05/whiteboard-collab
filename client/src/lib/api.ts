import axios, { AxiosError, AxiosRequestConfig } from "axios";

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = axios
      .post<ApiEnvelope<{ accessToken: string }>>("/api/auth/refresh", {}, { withCredentials: true })
      .then((res) => {
        accessToken = res.data.data.accessToken;
        return accessToken;
      })
      .catch(() => {
        accessToken = null;
        return null;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const isRefreshRequest = original?.url?.includes("/auth/refresh");

    if (error.response?.status === 401 && original && !original._retried && !isRefreshRequest) {
      original._retried = true;
      const newToken = await refreshAccessToken();
      if (newToken) {
        original.headers = { ...original.headers, Authorization: `Bearer ${newToken}` };
        return api(original);
      }
      window.dispatchEvent(new CustomEvent("auth:expired"));
    }
    return Promise.reject(error);
  },
);

export function apiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: { message?: string } } | undefined;
    return data?.error?.message ?? error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong";
}

export default api;
