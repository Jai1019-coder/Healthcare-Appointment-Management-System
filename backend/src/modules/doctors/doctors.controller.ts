import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import { doctorsService } from './doctors.service';

export const doctorsController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    const doctor = await doctorsService.create(req.body);
    return sendSuccess(res, 201, doctor, 'Doctor created');
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const doctors = await doctorsService.list(req.query as { specialization?: string; q?: string });
    return sendSuccess(res, 200, doctors);
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const doctor = await doctorsService.getById(req.params.doctorId);
    return sendSuccess(res, 200, doctor);
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const doctor = await doctorsService.update(req.params.doctorId, req.body);
    return sendSuccess(res, 200, doctor, 'Doctor updated');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    const result = await doctorsService.remove(req.params.doctorId);
    return sendSuccess(res, 200, result, 'Doctor deactivated');
  }),

  setWorkingHours: asyncHandler(async (req: Request, res: Response) => {
    const hours = await doctorsService.setWorkingHours(req.params.doctorId, req.body.workingHours);
    return sendSuccess(res, 200, hours, 'Working hours updated');
  }),
};
