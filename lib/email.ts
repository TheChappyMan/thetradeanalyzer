/**
 * Transactional email helpers — powered by Resend.
 *
 * All functions are server-only; never import this module from client components.
 * Requires RESEND_API_KEY to be set in the environment.
 * Verified sending domain: thetradeanalyzer.com
 */

import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM    = 'hello@thetradeanalyzer.com'
const APP_URL = 'https://app.thetradeanalyzer.com'

// ── Helpers ──────────────────────────────────────────────────────────────────

function acceptUrl(inviteToken: string): string {
  return `${APP_URL}/api/commissioner/accept-invite/${inviteToken}`
}

function inviteHtml(opts: {
  inviteToken:       string
  commissionerEmail: string
  isResend:          boolean
}): string {
  const ctaUrl  = acceptUrl(opts.inviteToken)
  const intro   = opts.isResend
    ? `<p>A reminder: <strong>${opts.commissionerEmail}</strong> has invited you to join their Fantasy Trade Analyzer commissioner group.</p>`
    : `<p><strong>${opts.commissionerEmail}</strong> has invited you to join their Fantasy Trade Analyzer commissioner group.</p>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You've been invited — thetradeanalyzer</title>
</head>
<body style="margin:0;padding:0;background:#FAF7F2;font-family:Inter,system-ui,sans-serif;color:#1A1A1A;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="560" style="max-width:560px;background:#FFFFFF;border-radius:16px;border:1px solid #E8E4DC;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:#0F4C5C;padding:24px 32px;">
              <span style="font-size:18px;font-weight:600;color:#FFFFFF;letter-spacing:-0.02em;">thetradeanalyzer</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#1A1A1A;letter-spacing:-0.02em;">
                ${opts.isResend ? "Reminder: you've been invited" : "You've been invited"}
              </h2>

              ${intro}

              <p style="margin:0 0 24px;color:#6B7C82;font-size:14px;line-height:1.6;">
                Accept your invitation to activate full Pro access shared by your commissioner.
              </p>

              <!-- CTA -->
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="border-radius:8px;background:#E9B44C;">
                    <a href="${ctaUrl}"
                       style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#1A1A1A;text-decoration:none;letter-spacing:-0.01em;">
                      Accept Invitation
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;font-size:12px;color:#6B7C82;line-height:1.6;">
                Or paste this link into your browser:<br />
                <a href="${ctaUrl}" style="color:#0F4C5C;word-break:break-all;">${ctaUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #E8E4DC;background:#FAF7F2;">
              <p style="margin:0;font-size:12px;color:#6B7C82;line-height:1.5;">
                If you did not expect this email, you can safely ignore it. The link expires after use.<br />
                <a href="${APP_URL}" style="color:#0F4C5C;text-decoration:none;">${APP_URL}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ── Exported functions ────────────────────────────────────────────────────────

/**
 * Sends a new commissioner seat invite.
 *
 * @param toEmail          - Recipient's email address
 * @param inviteToken      - The seat's unique invite token (used to build the accept URL)
 * @param commissionerEmail - The commissioner's email shown in the email body
 */
export async function sendInviteEmail(
  toEmail:           string,
  inviteToken:       string,
  commissionerEmail: string,
): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.log(
      `[email] sendInviteEmail (no RESEND_API_KEY):\n  to: ${toEmail}\n  url: ${acceptUrl(inviteToken)}`
    )
    return
  }

  const { error } = await resend.emails.send({
    from:    FROM,
    to:      [toEmail],
    subject: `${commissionerEmail} invited you to a Trade Analyzer group`,
    html:    inviteHtml({ inviteToken, commissionerEmail, isResend: false }),
  })

  if (error) {
    console.error('[email] sendInviteEmail error:', error)
  }
}

/**
 * Resends an existing commissioner seat invite (reminder).
 * Identical delivery to sendInviteEmail but the subject line and intro
 * make clear it is a reminder.
 *
 * @param toEmail          - Recipient's email address
 * @param inviteToken      - The seat's unique invite token
 * @param commissionerEmail - The commissioner's email shown in the email body
 */
export async function sendReinviteEmail(
  toEmail:           string,
  inviteToken:       string,
  commissionerEmail: string,
): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.log(
      `[email] sendReinviteEmail (no RESEND_API_KEY):\n  to: ${toEmail}\n  url: ${acceptUrl(inviteToken)}`
    )
    return
  }

  const { error } = await resend.emails.send({
    from:    FROM,
    to:      [toEmail],
    subject: `Reminder: ${commissionerEmail} invited you to a Trade Analyzer group`,
    html:    inviteHtml({ inviteToken, commissionerEmail, isResend: true }),
  })

  if (error) {
    console.error('[email] sendReinviteEmail error:', error)
  }
}
