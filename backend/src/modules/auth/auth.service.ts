import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { RegisterPatientInput, LoginInput } from './auth.schema';

function issueToken(userId: string, role: Role, email: string): string {
  const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign({ userId, role, email }, env.JWT_SECRET, options);
}

export const authService = {
  async registerPatient(input: RegisterPatientInput) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw ApiError.conflict('An account with this email already exists');

    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_SALT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        fullName: input.fullName,
        phone: input.phone,
        role: Role.PATIENT,
        patientProfile: {
          create: { dateOfBirth: input.dateOfBirth },
        },
      },
      include: { patientProfile: true },
    });

    const token = issueToken(user.id, user.role, user.email);
    return { token, user: sanitizeUser(user) };
  },

  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: { doctorProfile: true, patientProfile: true },
    });

    // Compare against a dummy hash if user not found, to keep response time
    // roughly constant and avoid leaking which emails are registered.
    const hashToCompare = user?.passwordHash ?? '$2b$10$invalidsaltinvalidsaltinvalidsaltinva';
    const valid = await bcrypt.compare(input.password, hashToCompare);

    if (!user || !valid) throw ApiError.unauthorized('Invalid email or password');
    if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');

    const token = issueToken(user.id, user.role, user.email);
    return { token, user: sanitizeUser(user) };
  },
};

function sanitizeUser<T extends { passwordHash: string }>(user: T) {
  const { passwordHash: _omit, ...rest } = user;
  return rest;
}
