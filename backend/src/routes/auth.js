/**
 * Shadow AI Auditor — Auth Routes
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? 'change-this-secret-in-production';
const TOKEN_TTL = '7d';

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
});

// POST /api/auth/register (admin creates users, or first-run)
router.post('/register', async (req, res) => {
  const { email, password, name, role, department } = req.body ?? {};
  if (!email || !password || !name) return res.status(400).json({ error: 'Missing fields' });

  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) return res.status(409).json({ error: 'Email already registered' });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ email, passwordHash, name, role: role ?? 'viewer', department });

  res.status(201).json({ id: user._id, email: user.email, name: user.name });
});

export default router;