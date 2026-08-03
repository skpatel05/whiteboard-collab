import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { apiErrorMessage } from "../lib/api";

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const verifyEmail = useAuthStore((s) => s.verifyEmail);
  const [status, setStatus] = useState<"pending" | "ok" | "error">("pending");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setStatus("error");
      setMessage("Missing verification token");
      return;
    }
    verifyEmail(token)
      .then(() => setStatus("ok"))
      .catch((err) => {
        setStatus("error");
        setMessage(apiErrorMessage(err));
      });
  }, [params, verifyEmail]);

  return (
    <div className="grid h-full place-items-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        {status === "pending" && <p className="text-slate-600">Verifying your email…</p>}
        {status === "ok" && (
          <>
            <p className="text-lg font-semibold text-green-600">Email verified!</p>
            <Link to="/dashboard" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
              Go to your dashboard
            </Link>
          </>
        )}
        {status === "error" && (
          <>
            <p className="text-lg font-semibold text-red-600">Verification failed</p>
            <p className="mt-1 text-sm text-slate-500">{message}</p>
          </>
        )}
      </div>
    </div>
  );
}
