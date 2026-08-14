import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { doctorsController } from './doctors.controller';
import { leaveController } from '../leave/leave.controller';
import {
  createDoctorSchema,
  updateDoctorSchema,
  setWorkingHoursSchema,
  createLeaveSchema,
  doctorIdParamSchema,
  leaveIdParamSchema,
  searchDoctorsQuerySchema,
} from './doctors.schema';

const router = Router();

// Public / any authenticated role: search & view doctor profiles.
router.get('/', authenticate, validate({ query: searchDoctorsQuerySchema }), doctorsController.list);
router.get('/:doctorId', authenticate, validate({ params: doctorIdParamSchema }), doctorsController.getById);

// Admin-only: doctor lifecycle management.
router.post('/', authenticate, authorize(Role.ADMIN), validate({ body: createDoctorSchema }), doctorsController.create);
router.patch(
  '/:doctorId',
  authenticate,
  authorize(Role.ADMIN),
  validate({ params: doctorIdParamSchema, body: updateDoctorSchema }),
  doctorsController.update
);
router.delete('/:doctorId', authenticate, authorize(Role.ADMIN), validate({ params: doctorIdParamSchema }), doctorsController.remove);
router.put(
  '/:doctorId/working-hours',
  authenticate,
  authorize(Role.ADMIN),
  validate({ params: doctorIdParamSchema, body: setWorkingHoursSchema }),
  doctorsController.setWorkingHours
);

// Admin-only: leave management (affects existing bookings + notifications).
router.post(
  '/:doctorId/leave',
  authenticate,
  authorize(Role.ADMIN),
  validate({ params: doctorIdParamSchema, body: createLeaveSchema }),
  leaveController.create
);
router.get('/:doctorId/leave', authenticate, authorize(Role.ADMIN, Role.DOCTOR), validate({ params: doctorIdParamSchema }), leaveController.list);
router.delete(
  '/:doctorId/leave/:leaveId',
  authenticate,
  authorize(Role.ADMIN),
  validate({ params: leaveIdParamSchema }),
  leaveController.remove
);

export default router;
