import { Router } from 'express';
import { authController } from './auth.controller';
import { validate } from '../../middleware/validate.middleware';
import { authenticate } from '../../middleware/auth.middleware';
import { registerPatientSchema, loginSchema } from './auth.schema';

const router = Router();

// Admin and Doctor accounts are provisioned by an admin (see doctors.routes.ts
// and prisma/seed.ts for the bootstrap admin) - only patients self-register.
router.post('/register', validate({ body: registerPatientSchema }), authController.registerPatient);
router.post('/login', validate({ body: loginSchema }), authController.login);
router.get('/me', authenticate, authController.me);

export default router;
