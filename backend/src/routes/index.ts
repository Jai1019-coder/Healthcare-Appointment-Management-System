import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes';
import doctorRoutes from '../modules/doctors/doctors.routes';
import appointmentRoutes from '../modules/appointments/appointments.routes';
import calendarRoutes from '../modules/calendar/calendar.routes';

const router = Router();

router.get('/health', (_req, res) => res.json({ success: true, message: 'OK', timestamp: new Date().toISOString() }));

router.use('/auth', authRoutes);
router.use('/doctors', doctorRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/calendar', calendarRoutes);

export default router;
