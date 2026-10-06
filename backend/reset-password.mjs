import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

const EMAIL = process.env.RESET_PASSWORD_EMAIL;
const PASSWORD = process.env.RESET_PASSWORD;
const MONGO_URI = process.env.MONGODB_URI;
const ORG_ID = process.env.RESET_PASSWORD_ORG_ID;

if (!EMAIL || !PASSWORD || !MONGO_URI || !mongoose.isValidObjectId(ORG_ID)) {
  throw new Error('RESET_PASSWORD_EMAIL, RESET_PASSWORD, MONGODB_URI, and a valid RESET_PASSWORD_ORG_ID are required.');
}

await mongoose.connect(MONGO_URI);

const hash = await bcrypt.hash(PASSWORD, 12);

const result = await mongoose.connection.collection('users').updateOne(
  { email: EMAIL, orgId: new mongoose.Types.ObjectId(ORG_ID) },
  { $set: { passwordHash: hash } }
);

if (result.matchedCount === 0) {
  console.log('No matching user found. No account was created.');
} else {
  console.log('Password reset successfully.');
}

await mongoose.disconnect();
process.exit(0);
