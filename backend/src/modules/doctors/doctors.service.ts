import bcrypt from 'bcrypt';
import { Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { CreateDoctorInput, UpdateDoctorInput } from './doctors.schema';

const doctorInclude = {
  user: { select: { id: true, email: true, fullName: true, phone: true, isActive: true } },
  workingHours: true,
} as const;

export const doctorsService = {
  async create(input: CreateDoctorInput) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw ApiError.conflict('An account with this email already exists');

    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_SALT_ROUNDS);

    return prisma.doctor.create({
      data: {
        specialization: input.specialization,
        slotDurationMinutes: input.slotDurationMinutes,
        bio: input.bio,
        user: {
          create: {
            email: input.email,
            passwordHash,
            fullName: input.fullName,
            phone: input.phone,
            role: Role.DOCTOR,
          },
        },
        workingHours: { createMany: { data: input.workingHours } },
      },
      include: doctorInclude,
    });
  },

  async list(filters: { specialization?: string; q?: string }) {
    return prisma.doctor.findMany({
      where: {
        specialization: filters.specialization
          ? { contains: filters.specialization, mode: 'insensitive' }
          : undefined,
        user: filters.q
          ? { fullName: { contains: filters.q, mode: 'insensitive' } }
          : { isActive: true },
      },
      include: doctorInclude,
      orderBy: { createdAt: 'desc' },
    });
  },

  async getById(doctorId: string) {
    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      include: { ...doctorInclude, leaves: { orderBy: { startDate: 'desc' } } },
    });
    if (!doctor) throw ApiError.notFound('Doctor not found');
    return doctor;
  },

  async update(doctorId: string, input: UpdateDoctorInput) {
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) throw ApiError.notFound('Doctor not found');

    return prisma.$transaction(async (tx) => {
      if (input.fullName || input.phone || input.isActive !== undefined) {
        await tx.user.update({
          where: { id: doctor.userId },
          data: {
            fullName: input.fullName,
            phone: input.phone,
            isActive: input.isActive,
          },
        });
      }
      return tx.doctor.update({
        where: { id: doctorId },
        data: {
          specialization: input.specialization,
          slotDurationMinutes: input.slotDurationMinutes,
          bio: input.bio,
        },
        include: doctorInclude,
      });
    });
  },

  async remove(doctorId: string) {
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) throw ApiError.notFound('Doctor not found');
    // Soft-delete: deactivate rather than hard-delete, to preserve appointment history.
    await prisma.user.update({ where: { id: doctor.userId }, data: { isActive: false } });
    return { deactivated: true };
  },

  async setWorkingHours(doctorId: string, workingHours: { dayOfWeek: number; startTime: string; endTime: string }[]) {
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) throw ApiError.notFound('Doctor not found');

    return prisma.$transaction(async (tx) => {
      await tx.doctorWorkingHour.deleteMany({ where: { doctorId } });
      await tx.doctorWorkingHour.createMany({
        data: workingHours.map((wh) => ({ ...wh, doctorId })),
      });
      return tx.doctorWorkingHour.findMany({ where: { doctorId } });
    });
  },
};
