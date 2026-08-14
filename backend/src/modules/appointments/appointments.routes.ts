import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { Role } from '@prisma/client';
import { appointmentsController } from './appointments.controller';
import {
  bookAppointmentSchema,
  rescheduleAppointmentSchema,
  cancelAppointmentSchema,
  appointmentIdParamSchema,
  postVisitSchema,
} from './appointments.schema';
import { doctorIdParamSchema } from '../doctors/doctors.schema';

const router = Router();

router.use(authenticate);

router.get('/availability/:doctorId', validate({ params: doctorIdParamSchema }), appointmentsController.getAvailability);

router.post('/', authorize(Role.PATIENT), validate({ body: bookAppointmentSchema }), appointmentsController.book);
router.get('/mine', authorize(Role.PATIENT, Role.DOCTOR), appointmentsController.listMine);
router.get('/:appointmentId', validate({ params: appointmentIdParamSchema }), appointmentsController.getById);

router.patch(
  '/:appointmentId/reschedule',
  authorize(Role.PATIENT),
  validate({ params: appointmentIdParamSchema, body: rescheduleAppointmentSchema }),
  appointmentsController.reschedule
);

router.patch(
  '/:appointmentId/cancel',
  authorize(Role.PATIENT),
  validate({ params: appointmentIdParamSchema, body: cancelAppointmentSchema }),
  appointmentsController.cancel
);

router.post(
  '/:appointmentId/post-visit',
  authorize(Role.DOCTOR),
  validate({ params: appointmentIdParamSchema, body: postVisitSchema }),
  appointmentsController.submitPostVisit
);

export default router;
