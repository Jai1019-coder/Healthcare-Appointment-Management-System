import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import { leaveService } from './leave.service';

export const leaveController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    const result = await leaveService.createLeave(req.params.doctorId, req.body);
    return sendSuccess(res, 201, result, 'Leave recorded and affected patients notified');
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const leaves = await leaveService.list(req.params.doctorId);
    return sendSuccess(res, 200, leaves);
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    const result = await leaveService.remove(req.params.doctorId, req.params.leaveId);
    return sendSuccess(res, 200, result, 'Leave removed');
  }),
};
