// backend/src/routes/auth.js
/**
 * Shadow AI Auditor — Auth Routes
 */
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/index.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? "change-this-secret-in-production";
const TOKEN_TTL = "7d";

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password required",
      });
    }

    const user = await User.findOne({
      email: email.toLowerCase(),
    });

    if (!user || !user.passwordHash) {
      return res.status(401).json({
        error: "Invalid credentials",
      });
    }

    const isMatch = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!isMatch) {
      return res.status(401).json({
        error: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      {
        userId: user._id,
        role: user.role,
      },
      JWT_SECRET,
      {
        expiresIn: TOKEN_TTL,
      }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);

    res.status(500).json({
      error: err.message,
    });
  }
});


router.post("/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        message: "All fields required",
      });
    }

    const exists = await User.findOne({
      email: email.toLowerCase(),
    });

    if (exists) {
      return res.status(409).json({
        message: "Email already registered",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await User.create({
      name: username,
      email,
      passwordHash,
      role: "viewer",
    });

    res.status(201).json({
      message: "Signup successful",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Server error",
    });
  }
});

router.get("/check-auth", (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.json({
        authenticated: false,
      });
    }

    const token = authHeader.split(" ")[1];

    jwt.verify(token, JWT_SECRET);

    res.json({
      authenticated: true,
    });
  } catch {
    res.json({
      authenticated: false,
    });
  }
});

router.post("/logout", (req, res) => {
  res.json({
    success: true,
  });
});

export default router;
