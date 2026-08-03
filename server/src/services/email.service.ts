import nodemailer from "nodemailer";
import { env } from "../config/env";
import { logger } from "../lib/logger";

const transporter = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  secure: env.smtp.port === 465,
  auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
});

/** Dev fallback: log emails to console when SMTP is not configured. */
export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  if (!env.smtp.host) {
    logger.info("Email (dev transport)", { to, subject, html });
    return;
  }
  await transporter.sendMail({
    from: env.smtp.from,
    to,
    subject,
    html,
  });
}

export function verificationEmailHtml(link: string): string {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:auto">
      <h2>Verify your email</h2>
      <p>Click the button below to confirm your Whiteboard account.</p>
      <a href="${link}"
         style="display:inline-block;background:#6366f1;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">
         Verify email
      </a>
      <p style="color:#888;font-size:12px">This link expires in 24 hours.</p>
    </div>
  `;
}
