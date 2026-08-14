import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import { authService } from './auth.service';

export const authController = {
  registerPatient: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.registerPatient(req.body);
    return sendSuccess(res, 201, result, 'Registration successful');
  }),

  login: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.login(req.body);
    return sendSuccess(res, 200, result, 'Login successful');
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    return sendSuccess(res, 200, req.user, 'Current session');
  }),
};
