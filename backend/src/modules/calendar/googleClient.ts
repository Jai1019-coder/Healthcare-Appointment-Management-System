import { google } from 'googleapis';
import { env } from '../../config/env';
import { prisma } from '../../config/prisma';

export const oauth2Client = new google.auth.OAuth2(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_REDIRECT_URI
);

export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

export function getGoogleAuthUrl(state: string): string {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    state,
  });
}

/**
 * Exchanges an OAuth2 authorization code for tokens and stores the refresh
 * token for the given user so future calendar operations can act on their
 * behalf without further interaction.
 */
export async function handleOAuthCallback(userId: string, code: string) {
  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    // Google only returns a refresh token on first consent; if the user has
    // already granted access before, ask them to revoke and reconnect.
    throw new Error('No refresh token returned - user may need to revoke prior access and reconnect.');
  }

  await prisma.googleAuthToken.upsert({
    where: { userId },
    create: {
      userId,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token ?? undefined,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
    },
    update: {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token ?? undefined,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
    },
  });
}

/** Returns an authenticated OAuth2 client for a specific user, or null if they haven't connected Google Calendar. */
export async function getAuthedClientForUser(userId: string) {
  const record = await prisma.googleAuthToken.findUnique({ where: { userId } });
  if (!record) return null;

  const client = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
  client.setCredentials({ refresh_token: record.refreshToken });
  return client;
}
