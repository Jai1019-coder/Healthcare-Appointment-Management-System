import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const saltRounds = 10;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@clinic.example.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, saltRounds),
      fullName: 'Clinic Administrator',
      role: Role.ADMIN,
    },
  });
  console.log(`Admin ready: ${admin.email} (password: ${adminPassword} - change after first login)`);

  const doctorEmail = 'dr.sarah@clinic.example.com';
  const existingDoctorUser = await prisma.user.findUnique({ where: { email: doctorEmail } });

  if (!existingDoctorUser) {
    const doctorUser = await prisma.user.create({
      data: {
        email: doctorEmail,
        passwordHash: await bcrypt.hash('DoctorPass123!', saltRounds),
        fullName: 'Sarah Chen',
        role: Role.DOCTOR,
      },
    });

    await prisma.doctor.create({
      data: {
        userId: doctorUser.id,
        specialization: 'General Physician',
        slotDurationMinutes: 30,
        bio: 'General physician with 10 years of experience in primary care.',
        workingHours: {
          createMany: {
            data: [
              { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
              { dayOfWeek: 2, startTime: '09:00', endTime: '17:00' },
              { dayOfWeek: 3, startTime: '09:00', endTime: '17:00' },
              { dayOfWeek: 4, startTime: '09:00', endTime: '17:00' },
              { dayOfWeek: 5, startTime: '09:00', endTime: '13:00' },
            ],
          },
        },
      },
    });
    console.log(`Sample doctor ready: ${doctorEmail} (password: DoctorPass123!)`);
  } else {
    console.log('Sample doctor already exists, skipping.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
