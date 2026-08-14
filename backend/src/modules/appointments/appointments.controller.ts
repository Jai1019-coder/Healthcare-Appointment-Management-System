import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import { ApiError } from '../../utils/ApiError';
import { appointmentsService } from './appointments.service';
import { availabilityService } from './availability.service';

export const appointmentsController = {
  getAvailability: asyncHandler(async (req: Request, res: Response) => {
    const slots = await availabilityService.getAvailableSlots(req.params.doctorId, new Date(req.query.date as string));
    return sendSuccess(res, 200, { slots });
  }),

  book: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const appointment = await appointmentsService.book(req.user.userId, req.body);
    return sendSuccess(res, 201, appointment, 'Appointment booked');
  }),

  reschedule: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const appointment = await appointmentsService.reschedule(req.user.userId, req.params.appointmentId, req.body.newSlotStart);
    return sendSuccess(res, 200, appointment, 'Appointment rescheduled');
  }),

  cancel: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const result = await appointmentsService.cancel(req.user.userId, req.params.appointmentId, req.body.reason);
    return sendSuccess(res, 200, result, 'Appointment cancelled');
  }),

  listMine: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const list =
      req.user.role === 'DOCTOR'
        ? await appointmentsService.listForDoctor(req.user.userId)
        : await appointmentsService.listForPatient(req.user.userId);
    return sendSuccess(res, 200, list);
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const appointment = await appointmentsService.getById(req.params.appointmentId);
    return sendSuccess(res, 200, appointment);
  }),

  submitPostVisit: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const appointment = await appointmentsService.submitPostVisit(req.user.userId, req.params.appointmentId, req.body);
    return sendSuccess(res, 200, appointment, 'Post-visit summary submitted');
  }),
};
