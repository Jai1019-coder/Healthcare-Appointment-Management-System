import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import { ApiError } from '../../utils/ApiError';
import { getGoogleAuthUrl, handleOAuthCallback } from './googleClient';
import { env } from '../../config/env';

const router = Router();

// Step 1: authenticated user requests a Google consent URL. `state` carries
// their userId so the callback (which Google redirects to, unauthenticated)
// knows whose account to attach the tokens to.
router.get(
  '/connect',
  authenticate,
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const url = getGoogleAuthUrl(req.user.userId);
    return sendSuccess(res, 200, { url });
  })
);

// Step 2: Google redirects here with ?code=...&state=<userId>
router.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) throw ApiError.badRequest('Missing code or state from Google OAuth redirect');

    await handleOAuthCallback(state, code);
    return res.redirect(`${env.FRONTEND_URL}/profile?calendarConnected=1`);
  })
);

export default router;
