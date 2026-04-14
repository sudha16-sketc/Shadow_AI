import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

const EMAIL    = 'sudhakarsutar101@gmail.com';
const PASSWORD = 'sudha@2216';
const MONGO_URI = 'mongodb://localhost:27017/shadow-ai-auditor';

await mongoose.connect(MONGO_URI);

const hash = await bcrypt.hash(PASSWORD, 12);

const result = await mongoose.connection.collection('users').updateOne(
  { email: EMAIL },
  { $set: { passwordHash: hash } }
);

if (result.matchedCount === 0) {
  console.log('No user found with that email — creating one...');
  await mongoose.connection.collection('users').insertOne({
    email: EMAIL,
    passwordHash: hash,
    name: 'Sudhakar',
    role: 'admin',
    department: '',
    isActive: true,
    optedOut: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log('User created successfully.');
} else {
  console.log('Password reset successfully.');
}

await mongoose.disconnect();
process.exit(0);
