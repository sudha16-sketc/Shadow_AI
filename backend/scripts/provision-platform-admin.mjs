import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { PlatformAdmin, User } from '../src/models/index.js';

const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.PLATFORM_ADMIN_PASSWORD;
const mongoUri = process.env.MONGODB_URI;

if (!email || !password || password.length < 16 || !mongoUri) {
  throw new Error('PLATFORM_ADMIN_EMAIL, a 16+ character PLATFORM_ADMIN_PASSWORD, and MONGODB_URI are required.');
}

try {
  await mongoose.connect(mongoUri);
  const [existingPlatformAdmin, existingTenantUser] = await Promise.all([
    PlatformAdmin.findOne({ email }),
    User.findOne({ email }),
  ]);
  if (existingPlatformAdmin || existingTenantUser) {
    throw new Error('This email is already assigned to an administrator or tenant user.');
  }

  await PlatformAdmin.create({
    email,
    passwordHash: await bcrypt.hash(password, 12),
    isActive: true,
    authVersion: 0,
  });
  console.log('Platform administrator provisioned.');
} finally {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}
